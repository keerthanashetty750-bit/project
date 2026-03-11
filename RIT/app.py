from flask import Flask, request, jsonify, render_template, session
import sqlite3
import hashlib
import os
import json
from datetime import datetime

app = Flask(__name__)
app.secret_key = 'retinal_secure_key_hackathon_2026'
DATABASE = 'database.db'

def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()

    c.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            retinal_hash TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            fiat_balance REAL DEFAULT 5000.00,
            gold_balance REAL DEFAULT 10.50,
            btc_balance REAL DEFAULT 0.85,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            asset_type TEXT NOT NULL,
            transaction_type TEXT NOT NULL,
            amount REAL NOT NULL,
            recipient TEXT,
            timestamp TEXT DEFAULT (datetime('now')),
            status TEXT DEFAULT 'Completed',
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    ''')

    # Seed demo users
    demo_users = [
        ('Arjun Sharma', 'arjun@example.com', 'EYE_SCAN_DEMO_001'),
        ('Priya Nair', 'priya@example.com', 'EYE_SCAN_DEMO_002'),
        ('Rohan Das', 'rohan@example.com', 'EYE_SCAN_DEMO_003'),
    ]

    for name, email, scan_code in demo_users:
        retinal_hash = hashlib.sha256(scan_code.encode()).hexdigest()
        existing = c.execute('SELECT id FROM users WHERE email=?', (email,)).fetchone()
        if not existing:
            c.execute('INSERT INTO users (name, email, retinal_hash) VALUES (?, ?, ?)',
                      (name, email, retinal_hash))
            user_id = c.lastrowid
            c.execute('INSERT INTO accounts (user_id) VALUES (?)', (user_id,))
            # Add some demo transactions
            c.execute('''INSERT INTO transactions (user_id, asset_type, transaction_type, amount, recipient)
                         VALUES (?, ?, ?, ?, ?)''',
                         (user_id, 'BTC', 'Deposit', 0.5, 'System'))
            c.execute('''INSERT INTO transactions (user_id, asset_type, transaction_type, amount, recipient)
                         VALUES (?, ?, ?, ?, ?)''',
                         (user_id, 'GOLD', 'Deposit', 5.0, 'Vault'))

    conn.commit()
    conn.close()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/authenticate', methods=['POST'])
def authenticate():
    data = request.get_json()
    scan_code = data.get('scan_code', '')
    
    if not scan_code:
        return jsonify({'success': False, 'message': 'No scan data received'}), 400

    retinal_hash = hashlib.sha256(scan_code.encode()).hexdigest()
    
    conn = get_db()
    user = conn.execute(
        'SELECT u.*, a.fiat_balance, a.gold_balance, a.btc_balance FROM users u JOIN accounts a ON u.id = a.user_id WHERE u.retinal_hash = ?',
        (retinal_hash,)
    ).fetchone()
    conn.close()

    if user:
        session['user_id'] = user['id']
        return jsonify({
            'success': True,
            'user': {
                'id': user['id'],
                'name': user['name'],
                'email': user['email'],
            },
            'balances': {
                'fiat': round(user['fiat_balance'], 2),
                'gold': round(user['gold_balance'], 4),
                'btc': round(user['btc_balance'], 6)
            }
        })
    else:
        return jsonify({'success': False, 'message': 'Retinal scan not recognized. Access Denied.'}), 401

@app.route('/api/balance', methods=['GET'])
def get_balance():
    user_id = request.args.get('user_id')
    if not user_id:
        return jsonify({'success': False, 'message': 'User ID required'}), 400

    conn = get_db()
    account = conn.execute(
        'SELECT * FROM accounts WHERE user_id = ?', (user_id,)
    ).fetchone()
    conn.close()

    if account:
        return jsonify({
            'success': True,
            'balances': {
                'fiat': round(account['fiat_balance'], 2),
                'gold': round(account['gold_balance'], 4),
                'btc': round(account['btc_balance'], 6)
            }
        })
    return jsonify({'success': False, 'message': 'Account not found'}), 404

@app.route('/api/transaction', methods=['POST'])
def make_transaction():
    data = request.get_json()
    user_id = data.get('user_id')
    asset_type = data.get('asset_type')
    transaction_type = data.get('transaction_type', 'Transfer')
    amount = float(data.get('amount', 0))
    recipient = data.get('recipient', 'Unknown')

    if not all([user_id, asset_type, amount]) or amount <= 0:
        return jsonify({'success': False, 'message': 'Invalid transaction parameters'}), 400

    conn = get_db()
    account = conn.execute('SELECT * FROM accounts WHERE user_id = ?', (user_id,)).fetchone()

    if not account:
        conn.close()
        return jsonify({'success': False, 'message': 'Account not found'}), 404

    # Check balance and deduct
    col_map = {'FIAT': 'fiat_balance', 'GOLD': 'gold_balance', 'BTC': 'btc_balance'}
    col = col_map.get(asset_type.upper())

    if not col:
        conn.close()
        return jsonify({'success': False, 'message': 'Unknown asset type'}), 400

    current_balance = account[col]
    if transaction_type.lower() in ['transfer', 'payment', 'withdraw'] and current_balance < amount:
        conn.close()
        return jsonify({'success': False, 'message': f'Insufficient {asset_type} balance'}), 400

    if transaction_type.lower() in ['transfer', 'payment', 'withdraw']:
        new_balance = current_balance - amount
    else:
        new_balance = current_balance + amount

    conn.execute(f'UPDATE accounts SET {col} = ? WHERE user_id = ?', (new_balance, user_id))
    conn.execute(
        'INSERT INTO transactions (user_id, asset_type, transaction_type, amount, recipient) VALUES (?, ?, ?, ?, ?)',
        (user_id, asset_type.upper(), transaction_type, amount, recipient)
    )
    conn.commit()

    updated_account = conn.execute('SELECT * FROM accounts WHERE user_id = ?', (user_id,)).fetchone()
    conn.close()

    return jsonify({
        'success': True,
        'message': f'{transaction_type} of {amount} {asset_type} successful!',
        'balances': {
            'fiat': round(updated_account['fiat_balance'], 2),
            'gold': round(updated_account['gold_balance'], 4),
            'btc': round(updated_account['btc_balance'], 6)
        }
    })

@app.route('/api/transactions', methods=['GET'])
def get_transactions():
    user_id = request.args.get('user_id')
    if not user_id:
        return jsonify({'success': False, 'message': 'User ID required'}), 400

    conn = get_db()
    txns = conn.execute(
        'SELECT * FROM transactions WHERE user_id = ? ORDER BY timestamp DESC LIMIT 10',
        (user_id,)
    ).fetchall()
    conn.close()

    return jsonify({
        'success': True,
        'transactions': [dict(t) for t in txns]
    })

if __name__ == '__main__':
    import socket
    init_db()
    hostname = socket.gethostname()
    local_ip = socket.gethostbyname(hostname)
    print("[OK] Database initialized successfully.")
    print("[>>] Starting Retinal Payment System server...")
    print(f"[>>] Local machine : http://127.0.0.1:5000")
    print(f"[>>] Network (LAN)  : http://{local_ip}:5000")
    print("[>>] Share the Network URL with other devices on the same Wi-Fi!")
    app.run(host='0.0.0.0', debug=True, port=5000)
