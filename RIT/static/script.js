// ============================================================
// RetinalPay — Frontend Logic
// ============================================================

let currentUser  = null;
let currentBalances = null;

// ── Helpers ─────────────────────────────────────────────────
function showToast(message, duration = 3200) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.remove('hidden');
    requestAnimationFrame(() => toast.classList.add('visible'));
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.classList.add('hidden'), 400);
    }, duration);
}

function setScreen(id) {
    document.querySelectorAll('.screen').forEach(s => {
        s.classList.remove('active');
        s.classList.add('hidden');
    });
    const target = document.getElementById(id);
    target.classList.remove('hidden');
    target.classList.add('active');
}

function updateGreeting(name) {
    const h  = new Date().getHours();
    const greet = h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : 'Good Evening';
    document.getElementById('greetUser').textContent = `${greet}, ${name} 👋`;
    document.getElementById('greetTime').textContent =
        new Date().toLocaleString('en-IN', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
}

function updateBalances(balances) {
    currentBalances = balances;
    document.getElementById('bal-fiat').textContent = `₹ ${Number(balances.fiat).toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
    document.getElementById('bal-gold').textContent = `${Number(balances.gold).toFixed(4)} g`;
    document.getElementById('bal-btc').textContent  = `${Number(balances.btc).toFixed(6)} BTC`;
}

// ── Landing ──────────────────────────────────────────────────
function showScanModal() {
    document.getElementById('scan-modal').classList.remove('hidden');
}
function closeScanModal() {
    document.getElementById('scan-modal').classList.add('hidden');
    resetScanUI();
}

// ── Scan logic ───────────────────────────────────────────────
function resetScanUI() {
    document.getElementById('scan-status').textContent    = 'READY TO SCAN';
    document.getElementById('scan-status').style.color   = 'var(--cyan)';
    const bar = document.getElementById('scan-progress-bar');
    bar.classList.add('hidden');
    document.getElementById('scan-fill').style.width    = '0';
    document.getElementById('demoUserSection').style.display = '';
}

function triggerScan(scanCode) {
    document.getElementById('demoUserSection').style.display = 'none';
    const statusEl = document.getElementById('scan-status');
    const bar      = document.getElementById('scan-progress-bar');
    const fill     = document.getElementById('scan-fill');

    // Start progress animation
    bar.classList.remove('hidden');
    statusEl.textContent = 'SCANNING...';
    statusEl.style.color = 'var(--cyan)';

    let progress = 0;
    const messages = ['MAPPING IRIS...', 'ANALYSING PATTERNS...', 'VERIFYING BIOMETRICS...', 'CROSS-REFERENCING...'];
    let msgIdx = 0;

    const interval = setInterval(() => {
        progress += 2;
        fill.style.width = `${Math.min(progress, 95)}%`;
        if (progress % 20 === 0 && msgIdx < messages.length) {
            statusEl.textContent = messages[msgIdx++];
        }
    }, 60);

    // Call backend after simulated scan (~3s)
    setTimeout(() => {
        clearInterval(interval);
        fill.style.width = '100%';

        fetch('/api/authenticate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scan_code: scanCode })
        })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                statusEl.textContent = '✔ IDENTITY CONFIRMED';
                statusEl.style.color = 'var(--success)';
                currentUser = data.user;
                setTimeout(() => {
                    closeScanModal();
                    loadDashboard(data.user, data.balances);
                }, 900);
            } else {
                statusEl.textContent = '✖ ACCESS DENIED';
                statusEl.style.color = 'var(--danger)';
                fill.style.background = 'var(--danger)';
                showToast('❌ ' + data.message);
                setTimeout(resetScanUI, 2500);
            }
        })
        .catch(() => {
            statusEl.textContent = 'SERVER ERROR';
            statusEl.style.color = 'var(--danger)';
            showToast('⚠️ Could not connect to server.');
            setTimeout(resetScanUI, 2000);
        });
    }, 3100);
}

// ── Dashboard ────────────────────────────────────────────────
function loadDashboard(user, balances) {
    document.getElementById('navUserName').textContent = user.name;
    updateGreeting(user.name);
    updateBalances(balances);
    setScreen('dashboard-screen');
    loadTransactionHistory();
    showToast(`✅ Welcome back, ${user.name}! Verified.`);
}

function loadTransactionHistory() {
    if (!currentUser) return;
    fetch(`/api/transactions?user_id=${currentUser.id}`)
      .then(r => r.json())
      .then(data => {
          const listEl = document.getElementById('txn-list');
          if (!data.success || data.transactions.length === 0) {
              listEl.innerHTML = '<p class="txn-empty">No transactions yet.</p>';
              return;
          }
          listEl.innerHTML = data.transactions.map(t => {
              const date = new Date(t.timestamp).toLocaleDateString('en-IN', {
                  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
              });
              const isDebit = ['Transfer','Payment','Withdraw'].includes(t.transaction_type);
              return `
                <div class="txn-item">
                  <div class="txn-item-left">
                    <div class="txn-item-asset asset-${t.asset_type}">● ${t.asset_type}</div>
                    <div class="txn-item-type">${t.transaction_type} → ${t.recipient || '—'}</div>
                    <div class="txn-item-time">${date}</div>
                  </div>
                  <div>
                    <div class="txn-item-amount asset-${t.asset_type}">${isDebit ? '−' : '+'}${t.amount} ${t.asset_type}</div>
                    <div class="txn-item-status">✔ ${t.status}</div>
                  </div>
                </div>`;
          }).join('');
      });
}

function submitTransaction() {
    if (!currentUser) { showToast('⚠️ Not authenticated.'); return; }

    const asset    = document.getElementById('txn-asset').value;
    const type     = document.getElementById('txn-type').value;
    const amount   = parseFloat(document.getElementById('txn-amount').value);
    const recipient= document.getElementById('txn-recipient').value || 'Unknown';
    const msgEl    = document.getElementById('txn-msg');

    if (!amount || isNaN(amount) || amount <= 0) {
        showTxnMsg('Please enter a valid amount.', 'error');
        return;
    }

    const btn = document.querySelector('.btn-txn');
    btn.disabled = true;
    btn.innerHTML = '<span>Processing...</span>';

    fetch('/api/transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            user_id: currentUser.id,
            asset_type: asset,
            transaction_type: type,
            amount: amount,
            recipient: recipient
        })
    })
    .then(r => r.json())
    .then(data => {
        btn.disabled = false;
        btn.innerHTML = '<span>🔐 Authorize & Send</span>';
        if (data.success) {
            updateBalances(data.balances);
            showTxnMsg('✔ ' + data.message, 'success');
            showToast('✅ Transaction successful!');
            document.getElementById('txn-amount').value    = '';
            document.getElementById('txn-recipient').value = '';
            loadTransactionHistory();
        } else {
            showTxnMsg('✖ ' + data.message, 'error');
            showToast('❌ ' + data.message);
        }
    })
    .catch(() => {
        btn.disabled = false;
        btn.innerHTML = '<span>🔐 Authorize & Send</span>';
        showTxnMsg('Server error. Please retry.', 'error');
    });
}

function showTxnMsg(msg, type) {
    const el = document.getElementById('txn-msg');
    el.textContent = msg;
    el.className = `txn-msg ${type}`;
    setTimeout(() => { el.className = 'txn-msg hidden'; }, 5000);
}

function logout() {
    currentUser    = null;
    currentBalances = null;
    resetScanUI();
    setScreen('landing-screen');
    showToast('👋 Logged out successfully.');
}
