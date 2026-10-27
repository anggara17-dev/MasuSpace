/* =====================================================================
   MASUSPACE POS - main.js
   PART 3 dari 6: inti (konstanta, helper, login, sesi, navigasi, dashboard)
   Jangan di-upload sendiri. Part 6 akan menutup file dan semua part digabung.
   ===================================================================== */
(function () {
    const SUPABASE_URL = 'https://lgyrypbzaspysibssttm.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxneXJ5cGJ6YXNweXNpYnNzdHRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2NDM4MzIsImV4cCI6MjEwNzIxOTgzMn0.lUPnYTvG8KjxQe2-e2FAhuDXbh6XA2g31Vc2_JWObN4';
    // ISI dengan email user Owner di Supabase (Authentication > Users)
    const OWNER_AUTH_EMAIL = 'khaerulanggara05@gmail.com';

    // Dibaca sebelum Supabase membersihkan hash URL (link reset password dari email)
    const RECOVERY_LINK = /type=recovery/.test(window.location.hash);
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    supabase.auth.onAuthStateChange(event => { if (event === 'PASSWORD_RECOVERY') window.openResetModal(); });
    document.addEventListener('submit', function (e) { e.preventDefault(); return false; });

    const OWNER_ONLY_PAGES = ['menu', 'categories', 'inventory', 'cash', 'reports', 'export', 'settings'];
    let state = {
        currentUser: null, authUserId: null, currentPage: 'dashboard',
        cart: [], categories: [], products: [],
        modalProduct: null, modalQty: 1,
        paymentMethod: 'cash', cashReceived: 0, discount: { type: 'percent', value: 0 },
        orderType: 'dine_in', currentReceipt: null, kasirExpenses: [], pendingPhotoBase64: null,
        printer: { type: null, device: null, name: null, vendorId: null, productId: null, id: null }
    };
    let dashboardRequestId = 0, dashboardFilterTimer;
    let orderRequestId = 0, orderFilterTimer;
    let reportRequestId = 0, reportFilterTimer;
    let toastTimer;

    /* ---------- Helper ---------- */
    const parseRp = v => Number(String(v ?? '').replace(/\D/g, '')) || 0;
    const fmtRp = v => (Math.round(Number(v) || 0)).toLocaleString('id-ID');
    function friendlyError(msg) { return /permission denied/i.test(msg || '') ? 'Izin database untuk akun kasir belum diatur. Minta Owner menjalankan SQL izin kasir.' : (msg || 'Gagal'); }
    function applyBrandLogo(url) {
        const ok = url && (url.startsWith('http') || url.startsWith('data:image'));
        ['brandLogoSidebar', 'brandLogoLogin'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ok ? `<img src="${escapeHtml(url)}" alt="">` : '<i class="fas fa-mug-hot"></i>'; });
    }
    async function loadBrandLogo() {
        try {
            const { data } = await supabase.from('app_users').select('avatar_url').eq('role', 'owner').eq('is_active', true).not('avatar_url', 'is', null).limit(1).maybeSingle();
            if (data?.avatar_url) { try { localStorage.setItem('masuspace-logo', data.avatar_url); } catch (e) { /* kuota penuh */ } applyBrandLogo(data.avatar_url); }
        } catch (e) { console.error(e); }
    }
    function formatRp(num) { return 'Rp ' + Math.round(Number(num) || 0).toLocaleString('id-ID'); }
    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function getJakartaDateParts(date = new Date()) {
        return Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' })
            .formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
    }
    function getTodayJakarta() { const { year, month, day } = getJakartaDateParts(); return `${year}-${month}-${day}`; }
    function getJakartaMonthStart() { const { year, month } = getJakartaDateParts(); return `${year}-${month}-01`; }
    function getJakartaDateDaysAgo(days) {
        const { year, month, day } = getJakartaDateParts();
        return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) - days)).toISOString().slice(0, 10);
    }
    function getJakartaDate() { return new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' }).format(new Date()); }
    function dayStartISO(dateStr) { return dateStr + 'T00:00:00+07:00'; }
    function dayEndExclusiveISO(dateStr) { return new Date(new Date(dateStr + 'T00:00:00+07:00').getTime() + 86400000).toISOString(); }
    const isValidDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && v >= '2020-01-01';
    let cashRequestId = 0;
    // Filter tanggal realtime: jalan begitu tanggal diubah (change/input), hanya bila tanggal valid
    function bindDateFilter(ids, fn, delay = 60) {
        let t;
        ids.forEach(id => ['change', 'input'].forEach(ev => document.getElementById(id)?.addEventListener(ev, () => {
            clearTimeout(t);
            t = setTimeout(() => { if (ids.every(i => { const v = document.getElementById(i)?.value; return v === '' || isValidDate(v); })) fn(); }, delay);
        })));
    }
    // Satu request (order + item sekaligus); fallback 2 request bila relasi tidak tersedia
    async function fetchOrders(startISO, endISO, { statuses = null, limit = 500, cols = '*' } = {}) {
        const build = sel => {
            let q = supabase.from('orders').select(sel).order('created_at', { ascending: false }).limit(limit);
            if (startISO) q = q.gte('created_at', startISO);
            if (endISO) q = q.lt('created_at', endISO);
            if (statuses) q = q.in('status', statuses);
            return q;
        };
        const first = await build(cols + ', order_items(qty, products(name))');
        if (!first.error) return first.data || [];
        const res = await build(cols);
        if (res.error) throw res.error;
        const orders = res.data || [];
        if (orders.length) {
            const { data: items, error } = await supabase.from('order_items').select('order_id,qty,products(name)').in('order_id', orders.map(o => o.id));
            if (error) throw error;
            const map = new Map();
            (items || []).forEach(i => { if (!map.has(i.order_id)) map.set(i.order_id, []); map.get(i.order_id).push(i); });
            orders.forEach(o => { o.order_items = map.get(o.id) || []; });
        }
        return orders;
    }
    // Penanda tutup kasir terakhir (disimpan di tabel settings, cadangan di browser)
    async function getLastClosedAt() {
        try {
            const { data, error } = await supabase.from('settings').select('value').eq('key', 'cashier_shift').maybeSingle();
            if (!error && data?.value?.last_closed_at) return data.value.last_closed_at;
        } catch (e) { console.error(e); }
        return localStorage.getItem('masuspace-last-closed') || null;
    }
    function showToast(msg, err = false) {
        const t = document.getElementById('toast');
        t.innerHTML = `<i class="fas ${err ? 'fa-circle-xmark' : 'fa-circle-check'}"></i><span>${escapeHtml(msg)}</span>`;
        t.className = 'toast show' + (err ? ' error' : '');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { t.className = 'toast'; }, err ? 5000 : 3000);
    }
    // Pengganti confirm() bawaan browser
    function confirmDialog(message, { title = 'Konfirmasi', okText = 'Ya, Lanjutkan', cancelText = 'Batal', danger = false, html = false } = {}) {
        return new Promise(resolve => {
            const ov = document.createElement('div');
            ov.className = 'modal-overlay active confirm-overlay';
            ov.innerHTML = `<div class="modal confirm-modal"><div class="confirm-body"><div class="confirm-icon ${danger ? 'danger' : ''}"><i class="fas ${danger ? 'fa-triangle-exclamation' : 'fa-circle-question'}"></i></div><h3>${escapeHtml(title)}</h3><div class="confirm-msg">${html ? message : escapeHtml(message).replace(/\n/g, '<br>')}</div><div class="confirm-actions"><button class="btn-secondary" data-r="0">${escapeHtml(cancelText)}</button><button class="btn-primary ${danger ? 'btn-danger' : ''}" data-r="1">${escapeHtml(okText)}</button></div></div></div>`;
            const onKey = e => { if (e.key === 'Escape') done(false); };
            const done = v => { document.removeEventListener('keydown', onKey); ov.remove(); resolve(v); };
            ov.addEventListener('click', e => { const b = e.target.closest('button[data-r]'); if (b) done(b.dataset.r === '1'); else if (e.target === ov) done(false); });
            document.addEventListener('keydown', onKey);
            document.body.appendChild(ov);
            ov.querySelector('[data-r="1"]').focus();
        });
    }
    function setAvatar(el, user) {
        if (!el) return;
        const url = user?.avatar_url;
        if (url && (url.startsWith('http') || url.startsWith('data:image'))) el.innerHTML = `<img src="${escapeHtml(url)}" alt="" style="width:100%;height:100%;object-fit:cover">`;
        else el.innerText = (user?.full_name || '?').charAt(0).toUpperCase();
    }

    /* ---------- Login ---------- */
    async function loadUsersToDropdown() {
        try {
            const { data } = await supabase.from('app_users').select('username, full_name, role').eq('is_active', true).order('full_name');
            const select = document.getElementById('loginUsername');
            if (!select) return;
            select.innerHTML = '<option value="">— pilih user —</option>';
            (data || []).forEach(user => {
                const option = document.createElement('option');
                option.value = user.username;
                option.dataset.role = user.role;
                option.textContent = `${user.full_name} (${user.role})`;
                select.appendChild(option);
            });
        } catch (e) { console.error(e); }
    }

    window.togglePassword = function () {
        const input = document.getElementById('loginPassword');
        const icon = document.getElementById('passwordIcon');
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        icon.classList.toggle('fa-eye', !show);
        icon.classList.toggle('fa-eye-slash', show);
    };

    async function activateUser(user, authUserId = null) {
        state.currentUser = user;
        state.authUserId = authUserId;
        document.getElementById('loginPage').style.display = 'none';
        document.getElementById('mainApp').style.display = 'flex';
        document.body.classList.toggle('role-kasir', user.role === 'kasir');
        const roleLabel = user.role === 'owner' ? 'Administrator' : 'Kasir';
        ['userName', 'userName2'].forEach(id => { document.getElementById(id).innerText = user.full_name; });
        ['userRole', 'userRole2'].forEach(id => { document.getElementById(id).innerText = roleLabel; });
        setAvatar(document.getElementById('userAvatar'), user);
        setAvatar(document.getElementById('userAvatar2'), user);
        document.querySelectorAll('.nav-item[data-page]').forEach(button => {
            button.style.display = button.classList.contains('owner-only') && user.role === 'kasir' ? 'none' : 'flex';
        });
        loadBrandLogo();
        await window.navigate(user.role === 'kasir' ? 'kasir' : 'dashboard');
    }

    window.handleLogin = async function (e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        const username = document.getElementById('loginUsername').value.trim();
        let isOwner = false;
        const password = document.getElementById('loginPassword').value;
        const btn = document.getElementById('loginBtn');
        const originalText = btn.innerHTML;
        if (!username || !password) { showToast('Isi username dan password!', true); return false; }
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Memproses...';
        btn.disabled = true;
        try {
            // Role ditentukan dari username yang diketik
            const { data: found, error: findError } = await supabase.from('app_users').select('role').eq('username', username).eq('is_active', true).maybeSingle();
            if (findError) throw new Error('Gagal memeriksa username. Coba lagi.');
            if (!found) throw new Error('Username tidak ditemukan.');
            isOwner = found.role === 'owner';
            if (isOwner) {
                const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email: OWNER_AUTH_EMAIL, password });
                if (OWNER_AUTH_EMAIL.indexOf('@') < 0) throw new Error('OWNER_AUTH_EMAIL di main.js belum diisi (masih placeholder). [v3]');
                if (authError || !authData?.user) {
                    const em = OWNER_AUTH_EMAIL.replace(/^(.{2}).*(@.*)$/, '$1***$2');
                    console.error('Login Owner gagal:', authError);
                    if (/not confirmed/i.test(authError?.message || '')) throw new Error('Email ' + em + ' belum dikonfirmasi di Supabase. [v3]');
                    throw new Error('Login ' + em + ' ditolak: email atau password tidak cocok. [v3]');
                }
                const { data: owner, error: ownerError } = await supabase.from('app_users')
                    .select('id, username, full_name, role, is_active, avatar_url, auth_user_id')
                    .eq('auth_user_id', authData.user.id).eq('role', 'owner').eq('is_active', true).maybeSingle();
                if (ownerError || !owner) {
                    await supabase.auth.signOut();
                    throw new Error('Akun Auth ini belum terhubung ke Owner MasuSpace (cek kolom auth_user_id).');
                }
                await activateUser(owner, authData.user.id);
            } else {
                await supabase.auth.signOut();
                const { data: cashier, error } = await supabase.from('app_users')
                    .select('id, username, full_name, role, is_active, avatar_url')
                    .eq('username', username).eq('password_hash', password).eq('is_active', true).single();
                if (error || !cashier || cashier.role !== 'kasir') throw new Error('Password kasir salah.');
                await activateUser(cashier);
            }
        } catch (error) {
            showToast(error.message || 'Gagal masuk.', true);
            const pw = document.getElementById('loginPassword');
            pw.value = '';
            pw.focus();
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
        return false;
    };

    window.restoreOwnerSession = async function () {
        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const authUserId = sessionData?.session?.user?.id;
            if (!authUserId) return;
            const { data: owner } = await supabase.from('app_users')
                .select('id, username, full_name, role, is_active, avatar_url, auth_user_id')
                .eq('auth_user_id', authUserId).eq('role', 'owner').eq('is_active', true).maybeSingle();
            if (owner) await activateUser(owner, authUserId);
            else await supabase.auth.signOut();
        } catch (error) { console.error('Gagal memulihkan sesi Owner:', error); }
    };

    window.logout = async function () {
        if (state.cart.length) window.saveCurrentHeldOrder();
        if (state.authUserId) await supabase.auth.signOut();
        state.currentUser = null;
        state.authUserId = null;
        state.cart = [];
        document.getElementById('mainApp').style.display = 'none';
        document.getElementById('loginPage').style.display = 'flex';
        document.getElementById('loginPassword').value = '';
        document.body.classList.remove('role-kasir');
        window.closeUserMenu();
    };

    window.toggleUserMenu = function () { document.getElementById('userDropdown').classList.toggle('show'); };
    window.closeUserMenu = function () { document.getElementById('userDropdown').classList.remove('show'); };
    document.addEventListener('click', function (e) {
        const userMenu = document.querySelector('.user-menu');
        if (userMenu && !userMenu.contains(e.target)) window.closeUserMenu();
    });

    /* ---------- Navigasi ---------- */
    const PAGE_TITLES = { dashboard: 'Dashboard', kasir: 'Kasir POS', orders: 'Riwayat Order', menu: 'Menu & Stok', cash: 'Kas & Bank', reports: 'Laporan', export: 'Export Transaksi', settings: 'Pengaturan' };
    window.navigate = async function (page) {
        if (!PAGE_TITLES[page]) return false;
        if (state.currentUser?.role === 'kasir' && OWNER_ONLY_PAGES.includes(page)) { showToast('Halaman ini khusus Owner.', true); return false; }
        state.currentPage = page;
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.getElementById(`page-${page}`)?.classList.add('active');
        document.querySelectorAll('.nav-item[data-page]').forEach(n => n.classList.toggle('active', n.dataset.page === page));
        document.getElementById('pageTitle').innerText = PAGE_TITLES[page];
        const loaders = { dashboard: loadDashboard, kasir: loadKasirData, orders: loadOrders, menu: loadMenuHub, cash: loadCash, reports: loadReports, export: loadExportPage, settings: loadSettings };
        try { await loaders[page](); } catch (error) { console.error(error); showToast('Gagal memuat halaman: ' + error.message, true); }
        if (window.innerWidth <= 1024) document.getElementById('sidebar').classList.add('collapsed');
        window.closeUserMenu();
    };
    window.toggleSidebar = function () { document.getElementById('sidebar').classList.toggle('collapsed'); };

    function updateClock() {
        const now = new Date();
        const clockEl = document.getElementById('liveClock');
        const dateEl = document.getElementById('headerDate');
        if (clockEl) clockEl.innerText = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta' }) + ' WIB';
        if (dateEl) dateEl.innerText = now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });
    }
    setInterval(updateClock, 1000); updateClock();

    /* ---------- Dashboard ---------- */
    async function loadDashboard() {
        const requestId = ++dashboardRequestId;
        const today = getTodayJakarta();
        const startInput = document.getElementById('dashboardStartDate');
        const endInput = document.getElementById('dashboardEndDate');
        if (startInput && !startInput.value) startInput.value = today;
        if (endInput && !endInput.value) endInput.value = today;
        const startDate = startInput?.value || today;
        const endDate = endInput?.value || today;
        if (startDate > endDate) { showToast('Tanggal awal tidak boleh melewati tanggal akhir.', true); return; }
        const rangeStart = dayStartISO(startDate);
        const rangeEnd = dayEndExclusiveISO(endDate);
        try {
            const [ordersResult, expensesResult, inventoryResult] = await Promise.all([
                fetchOrders(rangeStart, rangeEnd, { statuses: ['paid', 'completed'], cols: 'id,total,payment_method', limit: 1000 }),
                supabase.from('expenses').select('amount').gte('created_at', rangeStart).lt('created_at', rangeEnd),
                supabase.rpc('get_inventory_summary')
            ]);
            if (requestId !== dashboardRequestId) return;
            if (expensesResult.error) throw expensesResult.error;
            const orders = ordersResult || [];
            const expenses = expensesResult.data || [];
            const productItems = orders.flatMap(o => o.order_items || []);
            if (requestId !== dashboardRequestId) return;
            const totalRevenue = orders.reduce((s, o) => s + Number(o.total || 0), 0);
            const totalExpense = expenses.reduce((s, x) => s + Number(x.amount || 0), 0);
            const netProfit = totalRevenue - totalExpense;
            const pay = { cash: 0, qris: 0, debit: 0 };
            orders.forEach(o => { if (pay[o.payment_method] !== undefined) pay[o.payment_method] += Number(o.total || 0); });
            const cashierExpenses = expenses.filter(x => x.cash_sources?.name === 'Cash Kasir').reduce((s, x) => s + Number(x.amount || 0), 0);
            const lowStock = inventoryResult.error ? 0 : (Number(inventoryResult.data?.low_stock || 0) + Number(inventoryResult.data?.out_of_stock || 0));

            document.getElementById('statOrders').innerText = orders.length;
            document.getElementById('statRevenue').innerText = formatRp(totalRevenue);
            document.getElementById('statExpense').innerText = formatRp(totalExpense);
            document.getElementById('statProfit').innerText = formatRp(netProfit);
            document.getElementById('statProfit').style.color = netProfit >= 0 ? 'var(--primary-dark)' : '#ef4444';
            document.getElementById('statCash').innerText = formatRp(pay.cash - totalExpense);
            document.getElementById('statLowStock').innerText = lowStock;
            const isToday = startDate === today && endDate === today;
            document.getElementById('dashboardPaymentTitle').innerText = isToday ? 'Pembayaran Hari Ini' : 'Pembayaran Periode';

            const row = (icon, label, val, last) => `<div style="display:flex;justify-content:space-between;padding:10px 0;${last ? '' : 'border-bottom:1px solid var(--border)'}"><span><i class="fas ${icon}" style="color:var(--primary);margin-right:8px"></i>${label}</span><b>${formatRp(val)}</b></div>`;
            document.getElementById('dashPaymentMethods').innerHTML = row('fa-money-bill-wave', 'Cash', pay.cash) + row('fa-qrcode', 'QRIS', pay.qris) + row('fa-credit-card', 'Debit', pay.debit, true);

            const best = new Map();
            productItems.forEach(i => { const n = i.products?.name || 'Produk'; best.set(n, (best.get(n) || 0) + Number(i.qty || 0)); });
            const top = [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
            document.getElementById('dashTopProducts').innerHTML = top.length
                ? top.map(([name, qty], idx) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)"><span>${idx + 1}. ${escapeHtml(name)}</span><b>${qty} terjual</b></div>`).join('')
                : '<p style="color:var(--text-light);text-align:center;padding:20px">Belum ada penjualan pada periode ini</p>';
        } catch (error) { console.error(error); showToast('Gagal memuat dashboard: ' + error.message, true); }
    }
    window.loadDashboard = loadDashboard;
    window.applyDashboardFilter = function () { clearTimeout(dashboardFilterTimer); dashboardFilterTimer = setTimeout(loadDashboard, 180); };
    window.resetDashboardFilter = function () {
        clearTimeout(dashboardFilterTimer);
        const today = getTodayJakarta();
        document.getElementById('dashboardStartDate').value = today;
        document.getElementById('dashboardEndDate').value = today;
        loadDashboard();
    };

/* ===== AKHIR PART 3 ===== */
/* =====================================================================
   PART 4 dari 6: kasir (menu, pengeluaran cepat, keranjang, diskon,
   pembayaran, struk, draft order)
   ===================================================================== */

    /* ---------- Data kasir ---------- */
    async function loadKasirData() {
        if (state.categories.length === 0) {
            const [cats, prods] = await Promise.all([
                supabase.from('categories').select('*').eq('is_active', true).order('display_order'),
                supabase.from('products').select('*').eq('is_active', true).order('display_order')
            ]);
            state.categories = cats.data || [];
            state.products = prods.data || [];
        }
        renderCategories();
        renderProducts();
        await Promise.all([loadQuickExpenseSources(), loadKasirExpenses()]);
    }

    async function loadQuickExpenseSources() {
        const { data, error } = await supabase.rpc('get_cash_sources');
        const select = document.getElementById('quickExpenseSource');
        if (!select) return;
        if (error) { console.error(error); select.innerHTML = '<option value="">Sumber kas tidak tersedia</option>'; return; }
        select.innerHTML = '<option value="">Sumber Kas</option>' + (data || []).map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('');
    }

    async function loadKasirExpenses() {
        const from = await getShiftStart();
        const q = sel => supabase.from('expenses').select(sel).gte('created_at', from).lt('created_at', dayEndExclusiveISO(getTodayJakarta())).order('created_at', { ascending: false });
        let res = await q('*, cash_sources(name)');
        if (res.error) res = await q('*'); // akun kasir tidak punya akses ke tabel cash_sources
        state.kasirExpenses = res.data || [];
        const badge = document.getElementById('expenseCountBadge');
        if (badge) badge.innerText = state.kasirExpenses.length;
    }

    /* ---------- Pengeluaran kasir ---------- */
    window.showExpenseHistoryModal = function () {
        const content = document.getElementById('expenseHistoryContent');
        if (!state.kasirExpenses.length) {
            content.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-light)"><i class="fas fa-receipt" style="font-size:48px;margin-bottom:12px;opacity:.3"></i><p>Belum ada pengeluaran di shift ini</p></div>';
        } else {
            let total = 0;
            content.innerHTML = state.kasirExpenses.map(e => {
                total += Number(e.amount || 0);
                return `<div class="expense-history-modal-item"><div class="exp-info"><div class="exp-cat">${escapeHtml(e.category)}</div><div class="exp-desc">${escapeHtml(e.description || '-')}</div><div class="exp-time">${new Date(e.created_at).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' })} • ${escapeHtml(e.cash_sources?.name || '-')}</div></div><div class="exp-amount">-${formatRp(e.amount)}</div><div class="exp-actions"><button onclick="window.editExpense('${e.id}')" title="Edit"><i class="fas fa-edit"></i></button><button class="delete-exp-btn" onclick="window.deleteExpense('${e.id}')" title="Hapus"><i class="fas fa-trash"></i></button></div></div>`;
            }).join('') + `<div style="margin-top:16px;padding:12px;background:var(--primary-light);border-radius:8px;display:flex;justify-content:space-between;font-weight:700"><span>Total Pengeluaran Shift Ini</span><span style="color:var(--primary-dark)">${formatRp(total)}</span></div>`;
        }
        document.getElementById('expenseHistoryModal').classList.add('active');
    };
    window.editExpense = function (id) {
        const e = state.kasirExpenses.find(x => x.id === id);
        if (!e) return;
        document.getElementById('editExpenseId').value = id;
        document.getElementById('editExpenseCategory').value = e.category;
        document.getElementById('editExpenseAmount').value = fmtRp(e.amount);
        document.getElementById('editExpenseModal').classList.add('active');
    };
    window.saveEditedExpense = async function () {
        const id = document.getElementById('editExpenseId').value;
        const category = document.getElementById('editExpenseCategory').value.trim();
        const amount = parseRp(document.getElementById('editExpenseAmount').value);
        if (!category || amount <= 0) { showToast('Lengkapi data!', true); return; }
        const { data, error } = await supabase.rpc('update_expense', { p_expense_id: id, p_amount: amount, p_category: category, p_description: category });
        if (error || !data?.success) { showToast('Gagal: ' + (error?.message || data?.message || 'Unknown'), true); return; }
        showToast('Pengeluaran diupdate!');
        window.closeModal('editExpenseModal');
        await loadKasirExpenses();
        window.showExpenseHistoryModal();
    };
    window.deleteExpense = async function (id) {
        if (!(await confirmDialog('Hapus pengeluaran ini? Saldo akan dikembalikan.', { title: 'Hapus pengeluaran', okText: 'Hapus', danger: true }))) return;
        const { data, error } = await supabase.rpc('delete_expense', { p_expense_id: id });
        if (error || !data?.success) { showToast('Gagal: ' + (error?.message || data?.message || 'Unknown'), true); return; }
        showToast('Pengeluaran dihapus!');
        await loadKasirExpenses();
        window.showExpenseHistoryModal();
    };
    window.quickExpense = async function () {
        const source = document.getElementById('quickExpenseSource').value;
        const amount = parseRp(document.getElementById('quickExpenseAmount').value);
        const desc = document.getElementById('quickExpenseDesc').value.trim();
        if (!source) { showToast('Pilih sumber kas!', true); return; }
        if (amount <= 0) { showToast('Jumlah wajib!', true); return; }
        if (!desc) { showToast('Keterangan wajib!', true); return; }
        const { data, error } = await supabase.rpc('add_expense', { p_source_id: source, p_amount: amount, p_category: desc, p_description: desc, p_created_by: state.currentUser?.id || null });
        if (error || !data?.success) { showToast('Gagal: ' + friendlyError(error?.message || data?.message || 'Unknown'), true); return; }
        showToast('Pengeluaran dicatat!');
        document.getElementById('quickExpenseAmount').value = '';
        document.getElementById('quickExpenseDesc').value = '';
        await loadKasirExpenses();
    };

    /* ---------- Menu ---------- */
    function renderCategories() {
        const active = state.activeCategory || null;
        let h = `<div class="category-card ${active ? '' : 'active'}" onclick="window.selectCat(null, this)"><h4>🍽️ Semua</h4></div>`;
        state.categories.forEach(c => { h += `<div class="category-card ${active === c.id ? 'active' : ''}" onclick="window.selectCat('${c.id}', this)"><h4>${escapeHtml(c.icon || '')} ${escapeHtml(c.name)}</h4></div>`; });
        document.getElementById('categoriesContainer').innerHTML = h;
    }
    function renderProducts() {
        let list = state.products;
        if (state.activeCategory) list = list.filter(p => p.category_id === state.activeCategory);
        const search = (document.getElementById('searchInput')?.value || '').toLowerCase();
        if (search) list = list.filter(p => p.name.toLowerCase().includes(search));
        document.getElementById('productsGrid').innerHTML = list.length
            ? list.map(p => `<div class="product-card" onclick="window.openModal('${p.id}')"><div class="product-img"></div><div class="product-name">${escapeHtml(p.name)}</div><div class="product-price">${formatRp(p.base_price)}</div><button class="add-btn"><i class="fas fa-plus"></i></button></div>`).join('')
            : '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-light)">Tidak ada produk</div>';
    }
    window.selectCat = function (id, el) {
        state.activeCategory = id;
        document.querySelectorAll('.category-card').forEach(c => c.classList.remove('active'));
        if (el) el.classList.add('active');
        renderProducts();
    };
    document.getElementById('searchInput')?.addEventListener('input', renderProducts);

    /* ---------- Modal produk ---------- */
    function modalUnitPrice() {
        return Number(state.modalProduct.base_price);
    }
    window.openModal = function (pid) {
        const p = state.products.find(x => x.id === pid);
        if (!p) return;
        state.modalProduct = p;
        state.modalQty = 1;
        document.getElementById('modalProductName').innerText = p.name;
        document.getElementById('modalNotes').value = '';
        document.getElementById('modalQty').innerText = '1';
        updateModalTotal();
        document.getElementById('productModal').classList.add('active');
    };
    window.changeQty = function (d) {
        state.modalQty = Math.max(1, state.modalQty + d);
        document.getElementById('modalQty').innerText = state.modalQty;
        updateModalTotal();
    };
    function updateModalTotal() { if (state.modalProduct) document.getElementById('modalTotal').innerText = formatRp(modalUnitPrice() * state.modalQty); }

    /* ---------- Keranjang & diskon ---------- */
    function cartSubtotal() { return state.cart.reduce((s, i) => s + i.unit_price * i.qty, 0); }
    // Diskon dibatasi (persen 0-100, nominal tidak melebihi subtotal) dan dibulatkan ke rupiah
    function calcDiscount(sub) {
        const v = Math.max(Number(state.discount.value) || 0, 0);
        const d = state.discount.type === 'percent' ? sub * Math.min(v, 100) / 100 : v;
        return Math.min(Math.round(d), sub);
    }
    function cartTotal() { const sub = cartSubtotal(); return sub - calcDiscount(sub); }

    window.addToCart = function () {
        if (!state.modalProduct) return;
        const unitPrice = modalUnitPrice();
        const notes = document.getElementById('modalNotes').value.trim();
        const key = [state.modalProduct.id, notes].join('|');
        const idx = state.cart.findIndex(i => i.key === key);
        if (idx >= 0) state.cart[idx].qty += state.modalQty;
        else state.cart.push({ key, product_id: state.modalProduct.id, name: state.modalProduct.name, unit_price: unitPrice, qty: state.modalQty, notes });
        window.closeModal('productModal');
        renderCart();
        showToast(`${state.modalProduct.name} ditambahkan!`);
    };
    window.updateQty = function (idx, d) { state.cart[idx].qty += d; if (state.cart[idx].qty <= 0) state.cart.splice(idx, 1); renderCart(); };
    window.removeFromCart = function (idx) { state.cart.splice(idx, 1); renderCart(); };

    function renderCart() {
        const box = document.getElementById('orderList');
        if (!state.cart.length) {
            box.innerHTML = '<div class="empty-order"><i class="fas fa-shopping-basket"></i><p>Belum ada item</p></div>';
        } else {
            box.innerHTML = state.cart.map((item, idx) => `<div class="order-item"><div style="flex:1"><div style="font-weight:700">${escapeHtml(item.name)}</div><div style="font-size:11px;color:var(--text-light)">${formatRp(item.unit_price)}</div>${item.notes ? `<div style="font-size:10px;color:var(--text-light)">📝 ${escapeHtml(item.notes)}</div>` : ''}<div class="item-qty"><button class="qty-btn" onclick="window.updateQty(${idx},-1)">-</button><span style="font-weight:700;min-width:20px;text-align:center">${item.qty}</span><button class="qty-btn" onclick="window.updateQty(${idx},1)">+</button><button class="qty-btn" onclick="window.removeFromCart(${idx})" style="color:#ef4444;border-color:#ef4444"><i class="fas fa-trash"></i></button></div></div><div style="font-weight:800;font-size:14px">${formatRp(item.unit_price * item.qty)}</div></div>`).join('');
        }
        updateTotals();
    }
    function updateTotals() {
        const sub = cartSubtotal();
        const disc = calcDiscount(sub);
        const total = sub - disc;
        document.getElementById('subtotal').innerText = formatRp(sub);
        document.getElementById('total').innerText = formatRp(total);
        document.getElementById('btnTotal').innerText = formatRp(total);
        document.getElementById('placeOrderBtn').disabled = state.cart.length === 0;
        document.getElementById('discountRow').style.display = disc > 0 ? 'flex' : 'none';
        document.getElementById('discountAmount').innerText = '- ' + formatRp(disc);
    }
    window.applyInlineDiscount = function () {
        const type = document.getElementById('discountTypeInline').value;
        const el = document.getElementById('discountValueInline');
        if (type === 'fixed') el.value = el.value ? fmtRp(parseRp(el.value)) : '';
        const value = type === 'fixed' ? parseRp(el.value) : (parseFloat(el.value) || 0);
        state.discount = type === 'none' ? { type: 'percent', value: 0 } : { type, value };
        updateTotals();
    };
    function resetDiscountUI() {
        state.discount = { type: 'percent', value: 0 };
        document.getElementById('discountTypeInline').value = 'none';
        document.getElementById('discountValueInline').value = '';
    }
    window.setOrderType = function (type, btn) {
        state.orderType = type;
        document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    };

    /* ---------- Pembayaran ---------- */
    window.showPaymentModal = function () {
        if (!state.cart.length) return;
        document.getElementById('paymentTotal').innerText = formatRp(cartTotal());
        document.getElementById('cashReceived').value = '';
        document.getElementById('changeAmount').innerText = formatRp(0);
        state.cashReceived = 0;
        state.paymentMethod = 'cash';
        document.querySelectorAll('.method-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
        document.getElementById('cashInputSection').style.display = 'block';
        document.getElementById('paymentModal').classList.add('active');
    };
    window.selectPaymentMethod = function (method, btn) {
        state.paymentMethod = method;
        document.querySelectorAll('.method-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('cashInputSection').style.display = method === 'cash' ? 'block' : 'none';
    };
    window.calculateChange = function () {
        state.cashReceived = parseRp(document.getElementById('cashReceived').value);
        document.getElementById('changeAmount').innerText = formatRp(Math.max(0, state.cashReceived - cartTotal()));
    };
    window.setQuickCash = function (amount) { document.getElementById('cashReceived').value = fmtRp(amount); window.calculateChange(); };
    window.setExactCash = function () { document.getElementById('cashReceived').value = fmtRp(cartTotal()); window.calculateChange(); };

    window.processPayment = async function () {
        if (!state.cart.length) return;
        const sub = cartSubtotal();
        const discAmt = calcDiscount(sub);
        const total = sub - discAmt;
        if (state.paymentMethod === 'cash' && state.cashReceived < total) { showToast('Uang tidak cukup!', true); return; }
        const btn = document.querySelector('.confirm-payment-btn');
        btn.innerText = 'Memproses...';
        btn.disabled = true;
        try {
            const paid = state.paymentMethod === 'cash' ? state.cashReceived : total;
            const { data, error } = await supabase.rpc('checkout_order', {
                p_cashier_id: state.currentUser?.id || null,
                p_customer_name: document.getElementById('customerName').value.trim() || 'Walk-in',
                p_table_number: document.getElementById('tableNumber').value.trim(),
                p_order_type: state.orderType,
                p_items: state.cart.map(i => ({
                    product_id: i.product_id, variant_id: null, qty: i.qty, unit_price: i.unit_price, addons: [],
                    notes: i.notes || ''
                })),
                // diskon selalu dikirim sebagai nominal agar angka browser = server
                p_discount_amount: discAmt, p_discount_percent: 0, p_tax_amount: 0,
                p_payment_method: state.paymentMethod, p_paid_amount: paid, p_notes: ''
            });
            if (error) throw error;
            showToast(`✅ Order ${data.order_number} berhasil!`);
            state.currentReceipt = { ...data, items: [...state.cart], subtotal: sub, total: data.total ?? total, payment_method: state.paymentMethod, cash_received: paid, change: Math.max(0, paid - total), discount: discAmt };
            state.cart = [];
            resetDiscountUI();
            renderCart();
            document.getElementById('customerName').value = '';
            document.getElementById('tableNumber').value = '';
            window.closeModal('paymentModal');
            loadKasirExpenses();
            setTimeout(window.showReceipt, 300);
        } catch (e) {
            showToast('❌ ' + friendlyError(e.message), true);
        } finally {
            btn.innerText = 'Konfirmasi';
            btn.disabled = false;
        }
    };

    /* ---------- Struk ---------- */
    function receiptHtml(o) {
        return `<div class="receipt-header"><h3>☕ MASUSPACE</h3><p>Coffee Shop</p><p style="font-size:10px;margin-top:8px">${o.dateLabel}</p><p style="font-size:10px">${escapeHtml(o.number)}</p>${o.extraHeader || ''}</div><div style="margin-bottom:10px">${o.items.map(i => `<div class="receipt-item"><div>${escapeHtml(i.name)} x${i.qty}</div><div>${formatRp(i.unit_price * i.qty)}</div></div>${i.detail ? `<div style="font-size:10px;color:#666">&nbsp;&nbsp;${escapeHtml(i.detail)}</div>` : ''}`).join('')}</div><div class="receipt-total"><div class="receipt-item"><span>Subtotal</span><span>${formatRp(o.subtotal)}</span></div>${o.discount > 0 ? `<div class="receipt-item"><span>Diskon</span><span>-${formatRp(o.discount)}</span></div>` : ''}<div class="receipt-item" style="font-size:14px"><span>TOTAL</span><span>${formatRp(o.total)}</span></div><div class="receipt-item"><span>Bayar (${escapeHtml(String(o.method).toUpperCase())})</span><span>${formatRp(o.paid)}</span></div>${o.method === 'cash' ? `<div class="receipt-item"><span>Kembali</span><span>${formatRp(o.change)}</span></div>` : ''}</div><div style="text-align:center;margin-top:12px;font-size:10px"><p>━━━━━━━━━━━━━━━━━━━</p><p>Terima kasih!</p><p>Selamat menikmati ☕</p></div>`;
    }
    function printHtml(content) {
        const w = window.open('', '', 'width=400,height=600');
        if (!w) { showToast('Pop-up diblokir browser. Izinkan pop-up untuk mencetak.', true); return; }
        w.document.write(`<html><head><title>Struk</title><style>body{font-family:'Courier New',monospace;font-size:12px;padding:20px}.receipt-item{display:flex;justify-content:space-between;margin-bottom:4px}.receipt-header{text-align:center;margin-bottom:12px;border-bottom:1px dashed #000;padding-bottom:12px}.receipt-total{border-top:1px dashed #000;padding-top:8px;font-weight:bold}</style></head><body>${content}</body></html>`);
        w.document.close();
        w.print();
    }

    /* ---------- ESC/POS builder untuk thermal printer ---------- */
    // Konversi data struk (format receiptHtml) jadi string ESC/POS 58mm (32 kolom)
    function buildEscPosText(r) {
        const W = 32; // lebar kertas 58mm
        const center = t => {
            const pad = Math.max(0, (W - t.length) / 2 | 0);
            return ' '.repeat(pad) + t;
        };
        const right = t => ' '.repeat(Math.max(0, W - t.length)) + t;
        // wrap item name + price (kolom kiri 20, kanan 12)
        const line = (a, b) => {
            const maxA = W - b.length - 1;
            const aa = a.length > maxA ? a.slice(0, maxA) : a;
            return aa + ' ' + right(b);
        };
        let out = '';
        out += '\x1B\x40'; // init
        out += '\x1B\x21\x30'; // double width+height
        out += center('MASUSPACE') + '\n';
        out += '\x1B\x21\x00'; // normal
        out += center('Coffee Shop') + '\n';
        out += center(r.dateLabel) + '\n';
        out += center(r.number) + '\n';
        if (r.extraHeader) out += r.extraHeader; // sudah ada \n di tiap baris
        out += '-'.repeat(W) + '\n';
        r.items.forEach(i => {
            out += `${i.name} x${i.qty}\n`;
            out += line('  ' + (i.detail ? i.detail.slice(0, 18) : formatRp(i.unit_price)), formatRp(i.unit_price * i.qty)) + '\n';
        });
        out += '-'.repeat(W) + '\n';
        out += line('Subtotal', formatRp(r.subtotal)) + '\n';
        if (r.discount > 0) out += line('Diskon', '-' + formatRp(r.discount)) + '\n';
        out += '\x1B\x21\x20'; // double width
        out += line('TOTAL', formatRp(r.total)) + '\n';
        out += '\x1B\x21\x00'; // normal
        out += line('Bayar (' + String(r.method).toUpperCase() + ')', formatRp(r.paid)) + '\n';
        if (r.method === 'cash') out += line('Kembali', formatRp(r.change)) + '\n';
        out += '-'.repeat(W) + '\n';
        out += center('Terima kasih!') + '\n';
        out += center('Selamat menikmati') + '\n';
        out += '\x1B\x64\x03'; // feed 3 lines
        out += '\x1D\x56\x00'; // full cut
        return out;
    }

    // Cetak struk: kalau printer thermal terhubung → kirim ESC/POS; kalau tidak → fallback browser print
    async function printReceiptToEither(receiptData, fallbackContentSelector) {
        if (window.isThermalPrinterConnected && window.isThermalPrinterConnected()) {
            try {
                const ok = await window.printToThermalPrinter(buildEscPosText(receiptData));
                if (ok) {
                    showToast('Struk dicetak ke ' + window.getPrinterName());
                    return;
                }
            } catch (e) { console.error('Thermal print gagal, fallback ke browser:', e); }
        }
        // Fallback: print browser popup
        printHtml(document.querySelector(fallbackContentSelector).innerHTML);
    }
    window.showReceipt = function () {
        const r = state.currentReceipt;
        if (!r) return;
        document.querySelector('#receiptModal h2').innerText = 'Struk';
        document.getElementById('receiptContent').innerHTML = receiptHtml({
            dateLabel: getJakartaDate(), number: r.order_number,
            items: r.items.map(i => ({ name: i.name, qty: i.qty, unit_price: i.unit_price, detail: i.notes || '' })),
            subtotal: r.subtotal, discount: r.discount, total: r.total, method: r.payment_method, paid: r.cash_received, change: r.change
        });
        document.getElementById('receiptModal').classList.add('active');
    };
    window.printReceipt = function () {
        const r = state.currentReceipt;
        if (!r) return;
        const receiptData = {
            dateLabel: getJakartaDate(), number: r.order_number,
            items: r.items.map(i => ({ name: i.name, qty: i.qty, unit_price: i.unit_price, detail: i.notes || '' })),
            subtotal: r.subtotal, discount: r.discount, total: r.total,
            method: r.payment_method, paid: r.cash_received, change: r.change
        };
        printReceiptToEither(receiptData, '#receiptContent');
    };

    /* ---------- Draft order (disimpan di browser perangkat ini) ---------- */
    const heldOrdersStorageKey = 'masuspace-held-orders';
    function getHeldOrders() {
        try { return JSON.parse(localStorage.getItem(heldOrdersStorageKey) || '[]'); }
        catch (error) { console.error('Draft order rusak:', error); return []; }
    }
    function saveHeldOrders(orders) { localStorage.setItem(heldOrdersStorageKey, JSON.stringify(orders)); }
    function renderHeldOrders() {
        const box = document.getElementById('holdOrdersList');
        if (!box) return;
        const orders = getHeldOrders();
        box.innerHTML = orders.length ? orders.map(o => {
            const items = (o.items || []).map(i => `${escapeHtml(i.name)} × ${Number(i.qty || 0)}`).join(', ');
            const created = o.created_at ? new Date(o.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : '';
            const sub = (o.items || []).reduce((s, i) => s + i.unit_price * i.qty, 0);
            return `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px;border-bottom:1px solid var(--border)"><div style="min-width:0"><b>${escapeHtml(o.customer_name || 'Walk-in')}</b> • ${formatRp(sub)}<div style="font-size:12px;color:var(--text-light);margin-top:4px">${items || 'Tanpa menu'} • ${created}</div></div><div style="display:flex;gap:8px;flex-shrink:0"><button class="btn-primary" onclick="window.restoreHeldOrder('${o.id}')">Lanjutkan</button><button class="btn-secondary" onclick="window.deleteHeldOrder('${o.id}')">Hapus</button></div></div>`;
        }).join('') : '<p style="text-align:center;color:var(--text-light);padding:20px">Belum ada draft order di perangkat ini</p>';
    }
    window.showHoldOrders = function () { document.getElementById('holdOrdersModal').classList.add('active'); renderHeldOrders(); };
    window.saveCurrentHeldOrder = function () {
        if (!state.cart.length) { showToast('Tambahkan menu terlebih dahulu sebelum menyimpan draft.', true); return false; }
        const orders = getHeldOrders();
        orders.unshift({
            id: window.crypto?.randomUUID?.() || `draft-${Date.now()}`,
            created_at: new Date().toISOString(),
            cashier: state.currentUser?.full_name || '',
            customer_name: document.getElementById('customerName')?.value.trim() || 'Walk-in',
            table_number: document.getElementById('tableNumber')?.value.trim() || '',
            order_type: state.orderType,
            discount: { ...state.discount },
            items: state.cart
        });
        try { saveHeldOrders(orders); }
        catch (error) { showToast('Draft tidak tersimpan. Periksa penyimpanan browser.', true); return false; }
        state.cart = [];
        resetDiscountUI();
        document.getElementById('customerName').value = '';
        document.getElementById('tableNumber').value = '';
        renderCart();
        renderHeldOrders();
        showToast('Order disimpan sebagai draft di perangkat ini.');
        return true;
    };
    window.restoreHeldOrder = async function (id) {
        if (state.cart.length) {
            if (!(await confirmDialog('Order aktif akan disimpan otomatis sebagai draft, lalu draft ini dilanjutkan.', { title: 'Lanjutkan draft', okText: 'Lanjutkan' }))) return;
            if (!window.saveCurrentHeldOrder()) return;
        }
        const orders = getHeldOrders();
        const index = orders.findIndex(o => o.id === id);
        if (index < 0) { showToast('Draft order tidak ditemukan.', true); renderHeldOrders(); return; }
        const [order] = orders.splice(index, 1);
        try { saveHeldOrders(orders); }
        catch (error) { showToast('Draft tidak dapat dipindahkan dari penyimpanan browser.', true); return; }
        state.cart = Array.isArray(order.items) ? order.items : [];
        state.discount = order.discount || { type: 'percent', value: 0 };
        state.orderType = order.order_type || 'dine_in';
        document.getElementById('discountTypeInline').value = state.discount.value ? state.discount.type : 'none';
        document.getElementById('discountValueInline').value = state.discount.type === 'fixed' && state.discount.value ? fmtRp(state.discount.value) : (state.discount.value || '');
        document.getElementById('customerName').value = order.customer_name === 'Walk-in' ? '' : (order.customer_name || '');
        document.getElementById('tableNumber').value = order.table_number || '';
        document.querySelectorAll('.type-btn').forEach((b, i) => b.classList.toggle('active', (i === 0) === (state.orderType === 'dine_in')));
        renderCart();
        window.closeModal('holdOrdersModal');
        showToast('Draft order dilanjutkan.');
    };
    window.deleteHeldOrder = async function (id) {
        if (!(await confirmDialog('Draft order ini akan dihapus.', { title: 'Hapus draft', okText: 'Hapus', danger: true }))) return;
        try { saveHeldOrders(getHeldOrders().filter(o => o.id !== id)); }
        catch (error) { showToast('Draft tidak dapat dihapus dari penyimpanan browser.', true); return; }
        renderHeldOrders();
    };

/* ===== AKHIR PART 4 ===== */
/* =====================================================================
   PART 5 dari 6: laporan harian, tutup kasir, riwayat order, laporan
   ===================================================================== */

    /* ---------- Laporan harian + tutup kasir ---------- */
    // Awal shift berjalan: tutup kasir terakhir hari ini, atau awal hari
    async function getShiftStart() {
        const dayStart = dayStartISO(getTodayJakarta());
        const closedAt = await getLastClosedAt();
        return new Date(closedAt && new Date(closedAt) > new Date(dayStart) ? closedAt : dayStart).toISOString();
    }

    // Data satu shift: sejak tutup kasir terakhir (atau awal hari) sampai sekarang
    async function getShiftData() {
        const dayStart = dayStartISO(getTodayJakarta());
        const closedAt = await getLastClosedAt();
        const fromMs = closedAt && new Date(closedAt) > new Date(dayStart) ? new Date(closedAt).getTime() : new Date(dayStart).getTime();
        const from = new Date(fromMs).toISOString();
        const to = new Date().toISOString();
        const [orders, expRes] = await Promise.all([
            fetchOrders(from, to, { statuses: PAID_STATUS, cols: 'id,order_number,total,payment_method,created_at', limit: 1000 }),
            supabase.from('expenses').select('amount,category,description,created_at').gte('created_at', from).lt('created_at', to).order('created_at')
        ]);
        if (expRes.error) throw expRes.error;
        const expenses = expRes.data || [];
        const sum = (list, fn) => list.reduce((t, x) => t + Number(fn(x) || 0), 0);
        const totalRevenue = sum(orders, o => o.total);
        const qris = sum(orders.filter(o => o.payment_method === 'qris'), o => o.total);
        const debit = sum(orders.filter(o => o.payment_method === 'debit'), o => o.total);
        const totalExpenses = sum(expenses, x => x.amount);
        const cashSales = totalRevenue - qris - debit;
        const menu = new Map();
        orders.forEach(o => (o.order_items || []).forEach(i => { const n = i.products?.name || 'Menu'; menu.set(n, (menu.get(n) || 0) + Number(i.qty || 0)); }));
        return { from, to, afterClose: fromMs > new Date(dayStart).getTime(), orders, expenses, menu: [...menu.entries()].sort((x, y) => y[1] - x[1]), totalRevenue, qris, debit, cashSales, totalExpenses, cashExpected: cashSales - totalExpenses };
    }

    // Struk laporan shift / tutup kasir (dipakai untuk layar dan cetak)
    function shiftReceiptHtml(d, close) {
        const t = iso => new Date(iso).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' });
        const row = (l, v, bold) => `<div class="receipt-item"${bold ? ' style="font-weight:700"' : ''}><span>${l}</span><span>${v}</span></div>`;
        const head = txt => `<div style="margin:10px 0 4px;padding-top:6px;border-top:1px dashed #999;font-weight:700">${txt}</div>`;
        return `<div class="receipt-header"><h3>☕ MASUSPACE</h3><p>${close ? 'LAPORAN TUTUP KASIR' : 'LAPORAN SHIFT (BELUM DITUTUP)'}</p><p style="font-size:10px">${new Date(d.to).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'full' })}</p><p style="font-size:10px">Shift ${t(d.from)} - ${t(d.to)} WIB</p><p style="font-size:10px">Oleh: ${escapeHtml(state.currentUser?.full_name || '-')}</p></div>`
            + head('PENJUALAN') + row('Jumlah order', d.orders.length) + row('Total penjualan', formatRp(d.totalRevenue), true)
            + head('PEMBAYARAN') + row('Cash', formatRp(d.cashSales)) + row('QRIS', formatRp(d.qris)) + row('Debit', formatRp(d.debit))
            + head('MENU TERJUAL') + (d.menu.length ? d.menu.map(([n, q]) => row(escapeHtml(n), '× ' + q)).join('') : row('-', ''))
            + head('PENGELUARAN') + (d.expenses.length ? d.expenses.map(x => row(`${t(x.created_at)} ${escapeHtml(x.description || x.category || '-')}`, '-' + formatRp(x.amount))).join('') : row('Tidak ada pengeluaran', '')) + row('Total pengeluaran', '-' + formatRp(d.totalExpenses), true)
            + head('RINGKASAN CASH') + row('Total penjualan', formatRp(d.totalRevenue)) + row('QRIS + Debit', '-' + formatRp(d.qris + d.debit)) + row('Pengeluaran', '-' + formatRp(d.totalExpenses)) + row('Cash seharusnya', formatRp(d.cashExpected), true)
            + (close ? row('Uang fisik', formatRp(close.physical), true) + row('Selisih', formatRp(close.diff), true) + (close.notes ? `<p style="font-size:10px;margin-top:4px">Catatan: ${escapeHtml(close.notes)}</p>` : '') + `<p style="font-size:10px;margin-top:6px">Disetor ke Cash Umum: ${formatRp(close.physical)}. Shift baru mulai dari Rp 0.</p>` : '')
            + '<div style="display:flex;justify-content:space-between;margin-top:28px;font-size:10px;text-align:center"><div>Kasir<br><br><br>(__________)</div><div>Owner<br><br><br>(__________)</div></div>';
    }
    window.printShiftReport = function () { if (state.lastShift) printHtml(shiftReceiptHtml(state.lastShift, null)); };

    window.showDailyReport = async function () {
        const content = document.getElementById('dailyReportContent');
        content.innerHTML = '<div style="text-align:center;padding:20px">Memuat...</div>';
        document.getElementById('dailyReportModal').classList.add('active');
        try {
            const d = await getShiftData();
            state.lastShift = d;
            const canClose = state.currentUser?.role === 'owner' && state.authUserId;
            const closingPanel = canClose
                ? `<section id="cashierClosePanel" data-system="${d.cashExpected}" class="page-section" style="margin-top:18px"><h4 style="margin:0 0 8px">Tutup Kasir</h4><p style="margin:0 0 12px;color:var(--text-light)">Cash seharusnya di laci: <b>${formatRp(d.cashExpected)}</b>. Hitung uang fisik, lalu setor ke Cash Umum. Setelah ditutup, laporan lengkap (termasuk pengeluaran) bisa dicetak dan semua angka shift kembali Rp 0.</p><div class="input-group"><label>Uang fisik yang dihitung (Rp)</label><input id="cashierPhysicalCash" type="text" class="rp-input" inputmode="numeric" placeholder="Masukkan hasil hitung fisik"></div><div class="input-group"><label>Catatan selisih (wajib bila ada selisih)</label><input id="cashierCloseNotes" type="text" maxlength="500" placeholder="Contoh: selisih karena uang kembalian"></div><button class="btn-primary" onclick="window.closeCashierShift()"><i class="fas fa-lock"></i> Tutup Kasir & Setor ke Cash Umum</button></section>`
                : '<p style="margin-top:16px;font-size:12px;color:var(--text-light)">Tutup kasir dilakukan oleh Owner.</p>';
            const card = (label, val, color) => `<div class="stat-card"><div class="stat-info"><div class="stat-label">${label}</div><div class="stat-value" style="font-size:18px;${color ? 'color:' + color : ''}">${formatRp(val)}</div></div></div>`;
            const line = (label, val) => `<div style="display:flex;justify-content:space-between;padding:6px 0"><span>${label}</span><b>${formatRp(val)}</b></div>`;
            const box = inner => `<div style="max-height:170px;overflow-y:auto;border:1px solid var(--border);border-radius:8px">${inner}</div>`;
            const li = (l, r, color) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:8px 10px;border-bottom:1px solid var(--border);font-size:12px"><span>${l}</span><b style="${color ? 'color:' + color : ''}">${r}</b></div>`;
            const hhmm = iso => new Date(iso).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' });
            content.innerHTML =
                `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px"><span style="font-size:12px;color:var(--text-light)">Shift sejak ${hhmm(d.from)} WIB${d.afterClose ? ' (setelah tutup kasir terakhir)' : ''}</span><button class="btn-secondary" onclick="window.printShiftReport()"><i class="fas fa-print"></i> Cetak</button></div>` +
                `<div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr));gap:10px;margin-bottom:8px">${card('TOTAL PENJUALAN', d.totalRevenue)}${card('QRIS + DEBIT', d.qris + d.debit)}${card('TOTAL PENGELUARAN', d.totalExpenses, '#ef4444')}${card('CASH KASIR', d.cashExpected, d.cashExpected >= 0 ? 'var(--primary)' : '#ef4444')}</div>` +
                `<p style="font-size:11px;color:var(--text-light);margin-bottom:12px">Cash Kasir = Penjualan − QRIS − Debit − Pengeluaran</p>` +
                `<h4 style="margin:12px 0 8px">Pembayaran</h4><div style="background:var(--bg);padding:10px 12px;border-radius:8px">${line('Cash', d.cashSales)}${line('QRIS', d.qris)}${line('Debit', d.debit)}</div>` +
                `<h4 style="margin:14px 0 8px">Menu Terjual</h4>${box(d.menu.length ? d.menu.map(([n, q]) => li(escapeHtml(n), '× ' + q)).join('') : '<p style="color:var(--text-light);text-align:center;padding:14px">Belum ada penjualan</p>')}` +
                `<h4 style="margin:14px 0 8px">Pengeluaran</h4>${box(d.expenses.length ? d.expenses.map(x => li(`${hhmm(x.created_at)} · ${escapeHtml(x.description || x.category || '-')}`, '-' + formatRp(x.amount), '#ef4444')).join('') : '<p style="color:var(--text-light);text-align:center;padding:14px">Tidak ada pengeluaran</p>')}` + closingPanel;
        } catch (error) {
            content.innerHTML = '<p style="color:#ef4444;text-align:center">Gagal memuat: ' + escapeHtml(error.message) + '</p>';
        }
    };

    async function closeShiftManually(physical, notes) {
        const { data: sources, error } = await supabase.rpc('get_cash_sources');
        if (error) throw error;
        const kasir = (sources || []).find(x => x.name === 'Cash Kasir');
        const umum = (sources || []).find(x => x.name === 'Cash Umum');
        if (!kasir || !umum) throw new Error('Sumber kas "Cash Kasir" atau "Cash Umum" tidak ditemukan di Kas & Bank.');
        // 1) saldo sistem Cash Kasir disamakan dengan uang fisik (selisih tercatat sebagai penyesuaian)
        const r1 = await supabase.rpc('reconcile_cash_balance', { p_source_id: kasir.id, p_physical_balance: physical, p_description: 'Tutup kasir: ' + notes });
        if (r1.error || r1.data?.success === false) throw new Error(r1.error?.message || r1.data?.message || 'Penyesuaian saldo gagal.');
        // 2) seluruh uang fisik disetor ke Cash Umum, Cash Kasir kembali 0
        if (physical > 0) {
            const r2 = await supabase.rpc('transfer_cash', { p_from: kasir.id, p_to: umum.id, p_amount: physical, p_desc: 'Setoran tutup kasir', p_by: state.currentUser?.id || null });
            if (r2.error || !r2.data?.success) throw new Error('Saldo sudah disesuaikan, tetapi setoran gagal: ' + (r2.error?.message || r2.data?.message || 'Unknown') + '. Lakukan transfer manual di Kas & Bank.');
        }
    }

    window.closeCashierShift = async function () {
        if (state.currentUser?.role !== 'owner' || !state.authUserId) { showToast('Hanya Owner yang masuk lewat Supabase Auth dapat menutup kasir.', true); return; }
        const panel = document.getElementById('cashierClosePanel');
        const field = document.getElementById('cashierPhysicalCash');
        const physicalCash = parseRp(field?.value);
        if (!field || field.value.trim() === '' || !Number.isSafeInteger(physicalCash) || physicalCash < 0) { showToast('Masukkan hitung fisik dalam angka rupiah bulat.', true); return; }
        const button = panel.querySelector('button');
        button.disabled = true;
        try {
            // Ambil data terbaru; bila ada transaksi/pengeluaran baru sejak laporan dibuka, minta hitung ulang
            const snap = await getShiftData();
            const system = snap.cashExpected;
            if (system !== Number(panel.dataset.system)) { showToast('Ada transaksi atau pengeluaran baru. Laporan dimuat ulang, hitung ulang uang fisik.', true); await window.showDailyReport(); return; }
            const diff = physicalCash - system;
            const notes = document.getElementById('cashierCloseNotes')?.value.trim() || '';
            if (system <= 0 && physicalCash <= 0) { showToast('Tidak ada saldo Cash Kasir untuk ditutup.', true); return; }
            if (diff !== 0 && !notes) { showToast('Ada selisih ' + formatRp(diff) + '. Isi catatan selisih dulu.', true); return; }
            const row = (l, v, c) => `<div style="display:flex;justify-content:space-between;padding:6px 0"><span>${l}</span><b style="${c ? 'color:' + c : ''}">${v}</b></div>`;
            const okClose = await confirmDialog(
                `<div style="text-align:left;background:var(--bg);padding:10px 14px;border-radius:10px;margin-bottom:8px">${row('Cash seharusnya', formatRp(system))}${row('Uang fisik', formatRp(physicalCash))}${row('Selisih', formatRp(diff), diff === 0 ? 'var(--primary-dark)' : '#ef4444')}</div>Uang fisik disetor ke Cash Umum dan shift baru mulai dari Rp 0.`,
                { title: 'Tutup kasir sekarang?', okText: 'Tutup Kasir', html: true });
            if (!okClose) return;
            button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Memproses...';
            const fullNotes = `Seharusnya ${system} | Fisik ${physicalCash} | Selisih ${diff}` + (notes ? ' | ' + notes : '');
            const res = await supabase.rpc('close_cashier_shift', { p_physical_cash: physicalCash, p_notes: fullNotes });
            const dbBroken = res.error && /does not exist|column|relation|function/i.test(res.error.message || '');
            if (dbBroken) {
                console.warn('close_cashier_shift bermasalah, memakai jalur manual:', res.error);
                await closeShiftManually(physicalCash, fullNotes);
            } else {
                if (res.error) throw res.error;
                if (!res.data?.success) throw new Error(res.data?.message || 'Penutupan kasir gagal.');
            }
            // Penanda shift = batas waktu data laporan ini, supaya tidak ada transaksi yang terlewat
            const marker = { last_closed_at: snap.to, expected: system, physical: physicalCash, difference: diff, closed_by: state.currentUser?.full_name || '' };
            localStorage.setItem('masuspace-last-closed', marker.last_closed_at);
            const { error: markError } = await supabase.rpc('save_setting', { p_key: 'cashier_shift', p_value: marker });
            if (markError) showToast('Kasir ditutup, tetapi penanda shift gagal disimpan: ' + markError.message, true);
            // Tampilkan laporan tutup kasir lengkap (termasuk pengeluaran) dan siap cetak
            document.getElementById('receiptContent').innerHTML = shiftReceiptHtml(snap, { physical: physicalCash, diff, notes });
            document.querySelector('#receiptModal h2').innerText = 'Laporan Tutup Kasir';
            window.closeModal('dailyReportModal');
            document.getElementById('receiptModal').classList.add('active');
            if (!markError) showToast('Kasir ditutup. Klik Print untuk mencetak laporan.');
            if (state.currentPage === 'dashboard') loadDashboard();
            loadKasirExpenses(); // riwayat pengeluaran kasir ikut kembali kosong
        } catch (error) {
            console.error('Tutup kasir gagal:', error);
            showToast('Tutup kasir gagal: ' + (error.message || 'Unknown'), true);
        } finally {
            button.disabled = false;
            button.innerHTML = '<i class="fas fa-lock"></i> Tutup Kasir & Setor ke Cash Umum';
        }
    };

    /* ---------- Riwayat order ---------- */
    const PAID_STATUS = ['paid', 'completed'];
    async function loadOrders() {
        const requestId = ++orderRequestId;
        const startEl = document.getElementById('orderFilterStart');
        const endEl = document.getElementById('orderFilterEnd');
        if (!window._ordersInit) { window._ordersInit = true; startEl.value = endEl.value = getTodayJakarta(); }
        const start = startEl.value, end = endEl.value;
        if (start && end && start > end) { showToast('Tanggal awal tidak boleh melewati tanggal akhir.', true); return; }
        const tableBody = document.getElementById('ordersTableBody');
        tableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px">Memuat riwayat order...</td></tr>';
        try {
            const orders = await fetchOrders(start ? dayStartISO(start) : null, end ? dayEndExclusiveISO(end) : null, { limit: 500 });
            if (requestId !== orderRequestId) return;
            if (!orders.length) {
                tableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-light)">Tidak ada data</td></tr>';
                document.getElementById('ordersSummary').innerHTML = '';
                return;
            }
            const menuByOrder = new Map();
            orders.forEach(o => menuByOrder.set(o.id, (o.order_items || []).map(i => `${escapeHtml(i.products?.name || 'Produk')} × ${Number(i.qty || 0)}`)));
            let paidCount = 0, totalCash = 0, totalNonCash = 0, totalRevenue = 0;
            tableBody.innerHTML = orders.map(o => {
                const amount = Number(o.total || 0);
                const isPaid = PAID_STATUS.includes(o.status);
                if (isPaid) {
                    paidCount++; totalRevenue += amount;
                    if (o.payment_method === 'cash') totalCash += amount; else totalNonCash += amount;
                }
                const menus = menuByOrder.get(o.id) || [];
                const methodBadge = o.payment_method === 'cash' ? 'success' : o.payment_method === 'qris' ? 'info' : 'warning';
                const statusBadge = isPaid ? 'success' : o.status === 'cancelled' ? 'danger' : 'warning';
                return `<tr><td>${new Date(o.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'short', timeStyle: 'short' })}</td><td><span class="badge badge-info">${escapeHtml(o.order_type || '-')}</span></td><td>${escapeHtml(o.customer_name || 'Walk-in')}</td><td>${menus.join(', ') || 'Tidak ada detail menu'}</td><td><span class="badge badge-${methodBadge}">${escapeHtml((o.payment_method || '-').toUpperCase())}</span></td><td><b>${formatRp(amount)}</b></td><td><span class="badge badge-${statusBadge}">${escapeHtml(o.status || '-')}</span></td><td class="order-action-btns"><button onclick="window.viewOrderDetail('${o.id}')" title="Lihat & Cetak"><i class="fas fa-eye"></i></button><button onclick="window.editOrder('${o.id}')" title="${isPaid ? 'Order lunas terkunci' : 'Batalkan order'}" ${isPaid ? 'disabled' : ''}><i class="fas fa-edit"></i></button><button class="delete-btn" onclick="window.deleteOrder('${o.id}')" title="${isPaid ? 'Order lunas terkunci' : 'Hapus'}" ${isPaid ? 'disabled' : ''}><i class="fas fa-trash"></i></button></td></tr>`;
            }).join('');
            const card = (label, val) => `<div class="stat-card"><div class="stat-info"><div class="stat-label">${label}</div><div class="stat-value">${val}</div></div></div>`;
            document.getElementById('ordersSummary').innerHTML = `<div class="stats-grid" style="margin-bottom:16px">${card('Total Order', paidCount)}${card('Cash', formatRp(totalCash))}${card('Non-Tunai', formatRp(totalNonCash))}${card('Total Penjualan', formatRp(totalRevenue))}</div>`;
        } catch (error) {
            if (requestId !== orderRequestId) return;
            console.error(error);
            tableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:#ef4444">Gagal memuat riwayat order. Silakan coba lagi.</td></tr>';
            showToast('Gagal memuat riwayat order: ' + error.message, true);
        }
    }
    window.loadOrders = loadOrders;
    window.resetOrderFilter = function () {
        clearTimeout(orderFilterTimer);
        document.getElementById('orderFilterStart').value = getTodayJakarta();
        document.getElementById('orderFilterEnd').value = getTodayJakarta();
        loadOrders();
    };

    window.viewOrderDetail = async function (orderId) {
        window._lastOrderDetailId = orderId;
        const [orderRes, itemRes] = await Promise.all([
            supabase.from('orders').select('*, app_users(full_name)').eq('id', orderId).single(),
            supabase.from('order_items').select('*, products(name)').eq('order_id', orderId)
        ]);
        const order = orderRes.data;
        if (!order) { showToast('Order tidak ditemukan', true); return; }
        const items = (itemRes.data || []).map(i => ({ name: i.products?.name || 'Produk', qty: i.qty, unit_price: Number(i.unit_price), detail: i.notes || '' }));
        const sub = items.reduce((s, i) => s + i.unit_price * i.qty, 0);
        const total = Number(order.total || 0);
        document.getElementById('orderDetailContent').innerHTML = receiptHtml({
            dateLabel: new Date(order.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
            number: order.order_number,
            extraHeader: `<p style="font-size:10px">Kasir: ${escapeHtml(order.app_users?.full_name || '-')}</p><p style="font-size:10px">Customer: ${escapeHtml(order.customer_name || 'Walk-in')}</p>`,
            items, subtotal: sub, discount: Math.max(0, sub - total), total,
            method: order.payment_method || 'cash', paid: Number(order.paid_amount || total), change: Number(order.change_amount || 0)
        });
        document.getElementById('orderDetailModal').classList.add('active');
    };
    window.printOrderDetail = async function () {
        // Ambil data order dari content yang sudah dirender
        const orderRes = await supabase.from('orders').select('*, app_users(full_name)').eq('id', window._lastOrderDetailId || '').single().maybeSingle();
        const itemRes = await supabase.from('order_items').select('*, products(name)').eq('order_id', window._lastOrderDetailId || '');
        const order = orderRes.data || {};
        const items = (itemRes.data || []).map(i => ({ name: i.products?.name || 'Produk', qty: i.qty, unit_price: Number(i.unit_price), detail: i.notes || '' }));
        const sub = items.reduce((s, i) => s + i.unit_price * i.qty, 0);
        const total = Number(order.total || 0);
        const receiptData = {
            dateLabel: new Date(order.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
            number: order.order_number,
            extraHeader: `Kasir: ${order.app_users?.full_name || '-'}\nCustomer: ${order.customer_name || 'Walk-in'}\n`,
            items, subtotal: sub, discount: Math.max(0, sub - total), total,
            method: order.payment_method || 'cash',
            paid: Number(order.paid_amount || total), change: Number(order.change_amount || 0)
        };
        printReceiptToEither(receiptData, '#orderDetailContent');
    };

    // Order lunas terhubung ke kas, jurnal, dan stok, jadi tidak boleh diubah/dihapus langsung dari tabel
    async function guardOrderChange(orderId, label) {
        if (state.currentUser?.role !== 'owner') { showToast('Hanya Owner yang boleh ' + label + ' order.', true); return null; }
        const { data: o } = await supabase.from('orders').select('id,status,order_number').eq('id', orderId).single();
        if (!o) { showToast('Order tidak ditemukan', true); return null; }
        if (PAID_STATUS.includes(o.status)) { showToast('Order lunas terkunci karena terhubung ke kas & jurnal.', true); return null; }
        return o;
    }
    window.editOrder = async function (orderId) {
        const order = await guardOrderChange(orderId, 'mengubah');
        if (!order) return;
        const newStatus = 'cancelled';
        if (order.status === newStatus) { showToast('Order ini sudah dibatalkan.', true); return; }
        if (!(await confirmDialog(`Order ${order.order_number} akan ditandai dibatalkan.`, { title: 'Batalkan order', okText: 'Batalkan order', danger: true }))) return;
        const { error } = await supabase.from('orders').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', orderId);
        if (error) { showToast('Gagal: ' + error.message, true); return; }
        showToast('Order diupdate!');
        await loadOrders();
    };
    window.deleteOrder = async function (orderId) {
        if (!(await guardOrderChange(orderId, 'menghapus'))) return;
        if (!(await confirmDialog('Order ini akan dihapus permanen.', { title: 'Hapus order', okText: 'Hapus', danger: true }))) return;
        const { error } = await supabase.from('orders').delete().eq('id', orderId);
        if (error) { showToast('Gagal: ' + error.message, true); return; }
        showToast('Order dihapus');
        await loadOrders();
    };

    /* ---------- Laporan penjualan ---------- */
    async function loadReports() {
        document.getElementById('reportStartDate').value = getJakartaMonthStart();
        document.getElementById('reportEndDate').value = getTodayJakarta();
        await window.loadSalesReport();
    }
    window.loadReports = loadReports;
    window.setReportPreset = function (preset) {
        clearTimeout(reportFilterTimer);
        const today = getTodayJakarta();
        document.getElementById('reportStartDate').value = preset === 'week' ? getJakartaDateDaysAgo(6) : preset === 'month' ? getJakartaMonthStart() : today;
        document.getElementById('reportEndDate').value = today;
        window.loadSalesReport();
    };
    window.applyReportFilter = function () { clearTimeout(reportFilterTimer); reportFilterTimer = setTimeout(window.loadSalesReport, 180); };
    window.loadSalesReport = async function () {
        const requestId = ++reportRequestId;
        const start = document.getElementById('reportStartDate').value;
        const end = document.getElementById('reportEndDate').value;
        if (!start || !end) return;
        if (start > end) { showToast('Tanggal awal tidak boleh melewati tanggal akhir.', true); return; }
        const { data: orders, error } = await supabase.from('orders').select('id,total,payment_method,created_at')
            .gte('created_at', dayStartISO(start)).lt('created_at', dayEndExclusiveISO(end)).in('status', PAID_STATUS);
        if (requestId !== reportRequestId) return;
        if (error) { console.error(error); showToast('Gagal memuat laporan: ' + error.message, true); return; }
        const report = orders || [];
        const byDate = new Map();
        let totalRev = 0, totalCash = 0, totalNonCash = 0;
        report.forEach(o => {
            const t = Number(o.total || 0);
            const key = new Date(o.created_at).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' });
            const r = byDate.get(key) || { n: 0, cash: 0, qris: 0, debit: 0, total: 0, ts: new Date(o.created_at).getTime() };
            r.n++; r.total += t; totalRev += t;
            if (['cash', 'qris', 'debit'].includes(o.payment_method)) r[o.payment_method] += t;
            if (o.payment_method === 'cash') totalCash += t; else totalNonCash += t;
            byDate.set(key, r);
        });
        const card = (label, val) => `<div class="stat-card"><div class="stat-info"><div class="stat-label">${label}</div><div class="stat-value">${val}</div></div></div>`;
        document.getElementById('reportStats').innerHTML = card('Total Order', report.length) + card('Pendapatan', formatRp(totalRev)) + card('Cash', formatRp(totalCash)) + card('Non-Tunai', formatRp(totalNonCash));
        document.getElementById('reportTableBody').innerHTML = byDate.size
            ? [...byDate.entries()].sort((a, b) => b[1].ts - a[1].ts).map(([d, r]) => `<tr><td>${d}</td><td>${r.n}</td><td>${formatRp(r.cash)}</td><td>${formatRp(r.qris)}</td><td>${formatRp(r.debit)}</td><td><b>${formatRp(r.total)}</b></td></tr>`).join('')
            : '<tr><td colspan="6" style="text-align:center;padding:30px">Tidak ada data</td></tr>';
    };

/* ===== AKHIR PART 5 ===== */
/* =====================================================================
   PART 5.5: Export Transaksi Penjualan (per tanggal)
   ===================================================================== */

    let exportRequestId = 0;
    let exportFilterTimer;
    state.exportData = { orders: [], daily: [], summary: null, expenses: [], expensesByDate: new Map() };

    async function loadExportPage() {
        const startEl = document.getElementById('exportStartDate');
        const endEl = document.getElementById('exportEndDate');
        if (!startEl.value) startEl.value = getTodayJakarta();
        if (!endEl.value) endEl.value = getTodayJakarta();
        // Auto-load data pertama kali halaman dibuka
        await window.loadExportData();
    }
    window.loadExportPage = loadExportPage;

    window.setExportPreset = function (preset) {
        clearTimeout(exportFilterTimer);
        const today = getTodayJakarta();
        document.getElementById('exportStartDate').value = preset === 'week' ? getJakartaDateDaysAgo(6) : preset === 'month' ? getJakartaMonthStart() : today;
        document.getElementById('exportEndDate').value = today;
        window.loadExportData();
    };
    window.applyExportFilter = function () { clearTimeout(exportFilterTimer); exportFilterTimer = setTimeout(window.loadExportData, 180); };

    window.loadExportData = async function () {
        const requestId = ++exportRequestId;
        const start = document.getElementById('exportStartDate').value;
        const end = document.getElementById('exportEndDate').value;
        if (!start || !end) { showToast('Pilih tanggal awal & akhir dulu.', true); return; }
        if (start > end) { showToast('Tanggal awal tidak boleh melewati tanggal akhir.', true); return; }

        // Disable tombol export selagi loading
        ['btnExportExcel', 'btnExportCSV', 'btnExportPrint'].forEach(id => { const b = document.getElementById(id); if (b) b.disabled = true; });
        document.getElementById('exportDailyBody').innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px">Memuat data...</td></tr>';
        document.getElementById('exportDetailBody').innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px">Memuat data...</td></tr>';
        document.getElementById('exportExpenseBody').innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px">Memuat data...</td></tr>';

        try {
            const rangeStart = dayStartISO(start);
            const rangeEnd = dayEndExclusiveISO(end);
            const [orders, expensesResult] = await Promise.all([
                fetchOrders(rangeStart, rangeEnd, { statuses: PAID_STATUS, cols: 'id,order_number,total,payment_method,created_at,customer_name,order_type', limit: 2000 }),
                supabase.from('expenses').select('id,amount,category,description,created_at,cash_sources(name)').gte('created_at', rangeStart).lt('created_at', rangeEnd).order('created_at', { ascending: false })
            ]);
            if (requestId !== exportRequestId) return;
            if (expensesResult.error) throw expensesResult.error;
            const expenses = expensesResult.data || [];

            // Group orders by tanggal (Jakarta)
            const byDate = new Map();
            let totalRev = 0, totalCash = 0, totalQris = 0, totalDebit = 0;
            orders.forEach(o => {
                const t = Number(o.total || 0);
                const key = new Date(o.created_at).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' });
                const r = byDate.get(key) || { n: 0, cash: 0, qris: 0, debit: 0, total: 0, expense: 0, ts: new Date(o.created_at).getTime() };
                r.n++; r.total += t; totalRev += t;
                if (['cash', 'qris', 'debit'].includes(o.payment_method)) r[o.payment_method] += t;
                if (o.payment_method === 'cash') totalCash += t;
                else if (o.payment_method === 'qris') totalQris += t;
                else if (o.payment_method === 'debit') totalDebit += t;
                byDate.set(key, r);
            });

            // Group expenses by tanggal (Jakarta) & hitung total
            const expensesByDate = new Map();
            let totalExpense = 0;
            expenses.forEach(e => {
                const amt = Number(e.amount || 0);
                totalExpense += amt;
                const key = new Date(e.created_at).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' });
                expensesByDate.set(key, (expensesByDate.get(key) || 0) + amt);
                // Gabungkan ke byDate untuk baris yang sudah ada, atau buat baru
                const r = byDate.get(key) || { n: 0, cash: 0, qris: 0, debit: 0, total: 0, expense: 0, ts: new Date(e.created_at).getTime() };
                r.expense += amt;
                byDate.set(key, r);
            });

            const dailyArr = [...byDate.entries()].sort((a, b) => b[1].ts - a[1].ts);
            const cashReal = totalCash - totalExpense;
            state.exportData = {
                orders, daily: dailyArr, expenses,
                summary: { total: totalRev, cash: totalCash, qris: totalQris, debit: totalDebit, count: orders.length, days: dailyArr.length, expense: totalExpense, cashReal }
            };

            // Stats card
            document.getElementById('expStatOrders').innerText = orders.length;
            document.getElementById('expStatRevenue').innerText = formatRp(totalRev);
            document.getElementById('expStatCash').innerText = formatRp(totalCash);
            document.getElementById('expStatQris').innerText = formatRp(totalQris);
            document.getElementById('expStatDebit').innerText = formatRp(totalDebit);
            document.getElementById('expStatExpense').innerText = formatRp(totalExpense);
            const cashRealEl = document.getElementById('expStatCashReal');
            cashRealEl.innerText = formatRp(cashReal);
            cashRealEl.style.color = cashReal >= 0 ? 'var(--primary-dark)' : '#ef4444';
            document.getElementById('expStatDays').innerText = dailyArr.length;

            // Daily table (dengan kolom Pengeluaran & Cash Real)
            document.getElementById('exportDailyBody').innerHTML = dailyArr.length
                ? dailyArr.map(([d, r]) => {
                    const real = r.cash - r.expense;
                    return `<tr><td><b>${escapeHtml(d)}</b></td><td>${r.n}</td><td>${formatRp(r.cash)}</td><td>${formatRp(r.qris)}</td><td>${formatRp(r.debit)}</td><td><b>${formatRp(r.total)}</b></td><td style="color:#ef4444">${formatRp(r.expense)}</td><td style="font-weight:800;color:${real >= 0 ? 'var(--primary-dark)' : '#ef4444'}">${formatRp(real)}</td></tr>`;
                }).join('')
                    + `<tr style="background:var(--primary-50);font-weight:800"><td>TOTAL</td><td>${orders.length}</td><td>${formatRp(totalCash)}</td><td>${formatRp(totalQris)}</td><td>${formatRp(totalDebit)}</td><td>${formatRp(totalRev)}</td><td style="color:#ef4444">${formatRp(totalExpense)}</td><td style="color:${cashReal >= 0 ? 'var(--primary-dark)' : '#ef4444'}">${formatRp(cashReal)}</td></tr>`
                : '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-light)">Tidak ada transaksi pada rentang tanggal ini</td></tr>';

            // Detail transaksi penjualan
            document.getElementById('exportDetailBody').innerHTML = orders.length
                ? orders.map(o => {
                    const menus = (o.order_items || []).map(i => `${escapeHtml(i.products?.name || 'Produk')} × ${Number(i.qty || 0)}`).join(', ') || '-';
                    const methodBadge = o.payment_method === 'cash' ? 'success' : o.payment_method === 'qris' ? 'info' : 'warning';
                    return `<tr><td>${new Date(o.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'short', timeStyle: 'short' })}</td><td><b>${escapeHtml(o.order_number || '-')}</b></td><td><span class="badge badge-info">${escapeHtml(o.order_type || '-')}</span></td><td>${escapeHtml(o.customer_name || 'Walk-in')}</td><td>${menus}</td><td><span class="badge badge-${methodBadge}">${escapeHtml((o.payment_method || '-').toUpperCase())}</span></td><td><b>${formatRp(Number(o.total || 0))}</b></td></tr>`;
                }).join('')
                : '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-light)">Tidak ada transaksi penjualan pada rentang tanggal ini</td></tr>';

            // Detail pengeluaran
            document.getElementById('exportExpenseBody').innerHTML = expenses.length
                ? expenses.map(e => `<tr><td>${new Date(e.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'short', timeStyle: 'short' })}</td><td><b>${escapeHtml(e.category || '-')}</b></td><td>${escapeHtml(e.description || '-')}</td><td><span class="badge badge-warning">${escapeHtml(e.cash_sources?.name || '-')}</span></td><td style="color:#ef4444;font-weight:800">-${formatRp(Number(e.amount || 0))}</td></tr>`).join('')
                    + `<tr style="background:#fef2f2;font-weight:800"><td colspan="4">TOTAL PENGELUARAN</td><td style="color:#ef4444">-${formatRp(totalExpense)}</td></tr>`
                : '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text-light)">Tidak ada pengeluaran pada rentang tanggal ini</td></tr>';

            // Enable tombol export jika ada data (orders ATAU expenses)
            if (orders.length > 0 || expenses.length > 0) {
                ['btnExportExcel', 'btnExportCSV', 'btnExportPrint'].forEach(id => { const b = document.getElementById(id); if (b) b.disabled = false; });
            }
        } catch (error) {
            console.error(error);
            showToast('Gagal memuat data export: ' + error.message, true);
            document.getElementById('exportDailyBody').innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:#ef4444">Gagal memuat data</td></tr>';
            document.getElementById('exportDetailBody').innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:#ef4444">Gagal memuat data</td></tr>';
            document.getElementById('exportExpenseBody').innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:#ef4444">Gagal memuat data</td></tr>';
        }
    };

    // Export ke Excel (.xlsx) - 3 sheet: Ringkasan, Detail Transaksi, Detail Pengeluaran
    window.exportToExcel = function () {
        if (!state.exportData.orders.length && !state.exportData.expenses.length) { showToast('Tidak ada data untuk diexport. Klik Load Data dulu.', true); return; }
        if (typeof XLSX === 'undefined') { showToast('Library Excel (SheetJS) belum termuat. Cek koneksi internet.', true); return; }

        const start = document.getElementById('exportStartDate').value;
        const end = document.getElementById('exportEndDate').value;
        const periodLabel = start === end ? start : `${start} s/d ${end}`;
        const storeName = 'MASUSPACE Coffee';
        const s = state.exportData.summary;

        // Sheet 1: Ringkasan per Tanggal (dengan Pengeluaran & Cash Real)
        const summaryData = [
            ['LAPORAN PENJUALAN - ' + storeName],
            ['Periode', periodLabel],
            ['Diexport', new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB'],
            ['Oleh', state.currentUser?.full_name || '-'],
            [],
            ['RINGKASAN PER TANGGAL'],
            ['Tanggal', 'Jumlah Order', 'Cash (Rp)', 'QRIS (Rp)', 'Debit (Rp)', 'Total Penjualan (Rp)', 'Pengeluaran (Rp)', 'Cash Real (Rp)']
        ];
        state.exportData.daily.forEach(([d, r]) => {
            const real = r.cash - r.expense;
            summaryData.push([d, r.n, r.cash, r.qris, r.debit, r.total, -r.expense, real]);
        });
        summaryData.push(['TOTAL', s.count, s.cash, s.qris, s.debit, s.total, -s.expense, s.cashReal]);
        summaryData.push([]);
        summaryData.push(['RINGKASAN METODE PEMBAYARAN']);
        summaryData.push(['Metode', 'Jumlah Transaksi', 'Total (Rp)']);
        summaryData.push(['Cash', state.exportData.orders.filter(o => o.payment_method === 'cash').length, s.cash]);
        summaryData.push(['QRIS', state.exportData.orders.filter(o => o.payment_method === 'qris').length, s.qris]);
        summaryData.push(['Debit', state.exportData.orders.filter(o => o.payment_method === 'debit').length, s.debit]);
        summaryData.push([]);
        summaryData.push(['RINGKASAN CASH REAL']);
        summaryData.push(['Cash Sales (Rp)', s.cash]);
        summaryData.push(['Total Pengeluaran (Rp)', -s.expense]);
        summaryData.push(['Cash Real (Rp)', s.cashReal]);

        // Sheet 2: Detail Transaksi Penjualan
        const detailData = [
            ['No', 'Tanggal & Waktu', 'No. Order', 'Tipe Order', 'Customer', 'Daftar Menu', 'Metode Bayar', 'Total (Rp)']
        ];
        state.exportData.orders.forEach((o, idx) => {
            const menus = (o.order_items || []).map(i => `${i.products?.name || 'Produk'} x${Number(i.qty || 0)}`).join('; ') || '-';
            detailData.push([
                idx + 1,
                new Date(o.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
                o.order_number || '-',
                o.order_type || '-',
                o.customer_name || 'Walk-in',
                menus,
                (o.payment_method || '-').toUpperCase(),
                Number(o.total || 0)
            ]);
        });
        detailData.push([]);
        detailData.push(['', '', '', '', '', '', 'TOTAL', s.total]);

        // Sheet 3: Detail Pengeluaran
        const expenseData = [
            ['No', 'Tanggal & Waktu', 'Kategori', 'Deskripsi', 'Sumber Kas', 'Jumlah (Rp)']
        ];
        state.exportData.expenses.forEach((e, idx) => {
            expenseData.push([
                idx + 1,
                new Date(e.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
                e.category || '-',
                e.description || '-',
                e.cash_sources?.name || '-',
                -Number(e.amount || 0)
            ]);
        });
        expenseData.push([]);
        expenseData.push(['', '', '', '', 'TOTAL PENGELUARAN', -s.expense]);

        const wb = XLSX.utils.book_new();
        const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
        const ws2 = XLSX.utils.aoa_to_sheet(detailData);
        const ws3 = XLSX.utils.aoa_to_sheet(expenseData);

        // Set lebar kolom
        ws1['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 20 }, { wch: 16 }, { wch: 16 }];
        ws2['!cols'] = [{ wch: 5 }, { wch: 22 }, { wch: 18 }, { wch: 12 }, { wch: 16 }, { wch: 50 }, { wch: 14 }, { wch: 16 }];
        ws3['!cols'] = [{ wch: 5 }, { wch: 22 }, { wch: 18 }, { wch: 30 }, { wch: 16 }, { wch: 16 }];

        XLSX.utils.book_append_sheet(wb, ws1, 'Ringkasan');
        XLSX.utils.book_append_sheet(wb, ws2, 'Detail Penjualan');
        XLSX.utils.book_append_sheet(wb, ws3, 'Detail Pengeluaran');

        const filename = `Export_Transaksi_${start}_sd_${end}.xlsx`;
        XLSX.writeFile(wb, filename);
        showToast('Excel berhasil diexport: ' + filename);
    };

    // Export ke CSV (data mentah: penjualan + pengeluaran + ringkasan)
    window.exportToCSV = function () {
        if (!state.exportData.orders.length && !state.exportData.expenses.length) { showToast('Tidak ada data untuk diexport. Klik Load Data dulu.', true); return; }
        const start = document.getElementById('exportStartDate').value;
        const end = document.getElementById('exportEndDate').value;
        const s = state.exportData.summary;

        const rows = [];
        rows.push(['LAPORAN PENJUALAN MASUSPACE COFFEE']);
        rows.push(['Periode', start === end ? start : `${start} s/d ${end}`]);
        rows.push(['Diexport', new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB']);
        rows.push([]);
        rows.push(['== RINGKASAN PER TANGGAL ==']);
        rows.push(['Tanggal', 'Jumlah Order', 'Cash (Rp)', 'QRIS (Rp)', 'Debit (Rp)', 'Total Penjualan (Rp)', 'Pengeluaran (Rp)', 'Cash Real (Rp)']);
        state.exportData.daily.forEach(([d, r]) => {
            const real = r.cash - r.expense;
            rows.push([d, r.n, r.cash, r.qris, r.debit, r.total, -r.expense, real]);
        });
        rows.push(['TOTAL', s.count, s.cash, s.qris, s.debit, s.total, -s.expense, s.cashReal]);
        rows.push([]);
        rows.push(['== DETAIL TRANSAKSI PENJUALAN ==']);
        rows.push(['Tanggal & Waktu', 'No. Order', 'Tipe Order', 'Customer', 'Daftar Menu', 'Metode Bayar', 'Total (Rp)']);
        state.exportData.orders.forEach(o => {
            const menus = (o.order_items || []).map(i => `${i.products?.name || 'Produk'} x${Number(i.qty || 0)}`).join('; ') || '-';
            rows.push([
                new Date(o.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
                o.order_number || '-',
                o.order_type || '-',
                o.customer_name || 'Walk-in',
                menus,
                (o.payment_method || '-').toUpperCase(),
                Number(o.total || 0)
            ]);
        });
        rows.push(['', '', '', '', '', 'TOTAL', s.total]);
        rows.push([]);
        rows.push(['== DETAIL PENGELUARAN ==']);
        rows.push(['Tanggal & Waktu', 'Kategori', 'Deskripsi', 'Sumber Kas', 'Jumlah (Rp)']);
        state.exportData.expenses.forEach(e => {
            rows.push([
                new Date(e.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
                e.category || '-',
                e.description || '-',
                e.cash_sources?.name || '-',
                -Number(e.amount || 0)
            ]);
        });
        rows.push(['', '', '', 'TOTAL PENGELUARAN', -s.expense]);

        // Convert ke CSV dengan escape quote
        const csv = rows.map(r => r.map(c => {
            const v = String(c ?? '');
            return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
        }).join(';')).join('\n');

        // BOM utf-8 biar Excel baca karakter Indonesia dengan benar
        const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Export_Transaksi_${start}_sd_${end}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('CSV berhasil diexport.');
    };

    // Print laporan transaksi (penjualan + pengeluaran + cash real)
    window.printExportReport = function () {
        if (!state.exportData.orders.length && !state.exportData.expenses.length) { showToast('Tidak ada data untuk dicetak. Klik Load Data dulu.', true); return; }
        const start = document.getElementById('exportStartDate').value;
        const end = document.getElementById('exportEndDate').value;
        const periodLabel = start === end ? start : `${start} s/d ${end}`;
        const s = state.exportData.summary;
        const cashRealColor = s.cashReal >= 0 ? '#059669' : '#ef4444';

        const html = `
<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><title>Laporan Penjualan ${periodLabel}</title>
<style>
body{font-family:'Plus Jakarta Sans',Arial,sans-serif;padding:20px;color:#0f172a;font-size:12px}
h1{text-align:center;font-size:20px;margin-bottom:4px}
h2{font-size:14px;margin:18px 0 8px;border-bottom:2px solid #10b981;padding-bottom:4px}
h2.expense{border-bottom-color:#ef4444}
.sub{text-align:center;color:#64748b;margin-bottom:18px;font-size:12px}
table{width:100%;border-collapse:collapse;margin-bottom:12px}
th,td{border:1px solid #e2e8f0;padding:6px 8px;text-align:left;font-size:11px}
th{background:#ecfdf5;font-weight:700;text-transform:uppercase;font-size:10px;color:#059669}
th.expense-h{background:#fef2f2;color:#ef4444}
tr.total{font-weight:800;background:#d1fae5}
tr.total-expense{font-weight:800;background:#fee2e2}
td.neg{color:#ef4444}
td.cashreal{font-weight:800}
.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 0}
.summary div{padding:10px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc}
.summary .lbl{font-size:10px;color:#64748b;text-transform:uppercase;font-weight:600}
.summary .val{font-size:14px;font-weight:800;color:#0f172a;margin-top:2px}
.foot{margin-top:24px;text-align:center;font-size:10px;color:#94a3b8}
@media print{body{padding:0}}</style></head><body>
<h1>MASUSPACE COFFEE</h1>
<p class="sub">Laporan Transaksi Penjualan + Pengeluaran<br>Periode: ${periodLabel}<br>Diexport: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB • Oleh: ${escapeHtml(state.currentUser?.full_name || '-')}</p>
<div class="summary">
<div><div class="lbl">Total Order</div><div class="val">${s.count}</div></div>
<div><div class="lbl">Total Penjualan</div><div class="val">Rp ${s.total.toLocaleString('id-ID')}</div></div>
<div><div class="lbl">Cash Sales</div><div class="val">Rp ${s.cash.toLocaleString('id-ID')}</div></div>
<div><div class="lbl">QRIS + Debit</div><div class="val">Rp ${(s.qris + s.debit).toLocaleString('id-ID')}</div></div>
<div><div class="lbl">Total Pengeluaran</div><div class="val" style="color:#ef4444">Rp ${s.expense.toLocaleString('id-ID')}</div></div>
<div><div class="lbl">Cash Real</div><div class="val" style="color:${cashRealColor}">Rp ${s.cashReal.toLocaleString('id-ID')}</div></div>
<div><div class="lbl">Hari Aktif</div><div class="val">${s.days}</div></div>
<div><div class="lbl">Formula</div><div class="val" style="font-size:11px">Cash Real = Cash − Pengeluaran</div></div>
</div>
<h2>Ringkasan per Tanggal</h2>
<table><thead><tr><th>Tanggal</th><th>Order</th><th>Cash</th><th>QRIS</th><th>Debit</th><th>Penjualan</th><th>Pengeluaran</th><th>Cash Real</th></tr></thead><tbody>
${state.exportData.daily.map(([d, r]) => {
    const real = r.cash - r.expense;
    return `<tr><td>${escapeHtml(d)}</td><td>${r.n}</td><td>Rp ${r.cash.toLocaleString('id-ID')}</td><td>Rp ${r.qris.toLocaleString('id-ID')}</td><td>Rp ${r.debit.toLocaleString('id-ID')}</td><td><b>Rp ${r.total.toLocaleString('id-ID')}</b></td><td class="neg">Rp ${r.expense.toLocaleString('id-ID')}</td><td class="cashreal" style="color:${real >= 0 ? '#059669' : '#ef4444'}">Rp ${real.toLocaleString('id-ID')}</td></tr>`;
}).join('')}
<tr class="total"><td>TOTAL</td><td>${s.count}</td><td>Rp ${s.cash.toLocaleString('id-ID')}</td><td>Rp ${s.qris.toLocaleString('id-ID')}</td><td>Rp ${s.debit.toLocaleString('id-ID')}</td><td>Rp ${s.total.toLocaleString('id-ID')}</td><td class="neg">Rp ${s.expense.toLocaleString('id-ID')}</td><td class="cashreal" style="color:${cashRealColor}">Rp ${s.cashReal.toLocaleString('id-ID')}</td></tr>
</tbody></table>
<h2>Detail Transaksi Penjualan</h2>
<table><thead><tr><th>No</th><th>Waktu</th><th>No. Order</th><th>Tipe</th><th>Customer</th><th>Menu</th><th>Metode</th><th>Total</th></tr></thead><tbody>
${state.exportData.orders.map((o, i) => {
    const menus = (o.order_items || []).map(it => `${escapeHtml(it.products?.name || 'Produk')} x${Number(it.qty || 0)}`).join(', ') || '-';
    return `<tr><td>${i + 1}</td><td>${new Date(o.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'short', timeStyle: 'short' })}</td><td>${escapeHtml(o.order_number || '-')}</td><td>${escapeHtml(o.order_type || '-')}</td><td>${escapeHtml(o.customer_name || 'Walk-in')}</td><td>${menus}</td><td>${(o.payment_method || '-').toUpperCase()}</td><td><b>Rp ${Number(o.total || 0).toLocaleString('id-ID')}</b></td></tr>`;
}).join('')}
</tbody></table>
<h2 class="expense">Detail Pengeluaran</h2>
<table><thead><tr class="expense-h"><th>Waktu</th><th>Kategori</th><th>Deskripsi</th><th>Sumber Kas</th><th>Jumlah</th></tr></thead><tbody>
${state.exportData.expenses.map(e => `<tr><td>${new Date(e.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'short', timeStyle: 'short' })}</td><td><b>${escapeHtml(e.category || '-')}</b></td><td>${escapeHtml(e.description || '-')}</td><td>${escapeHtml(e.cash_sources?.name || '-')}</td><td class="neg"><b>-Rp ${Number(e.amount || 0).toLocaleString('id-ID')}</b></td></tr>`).join('')}
<tr class="total-expense"><td colspan="4">TOTAL PENGELUARAN</td><td class="neg">-Rp ${s.expense.toLocaleString('id-ID')}</td></tr>
</tbody></table>
<p class="foot">Laporan ini dibuat otomatis oleh MasuSpace POS — ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}</p>
</body></html>`;

        const w = window.open('', '_blank');
        if (!w) { showToast('Pop-up diblokir browser. Izinkan pop-up untuk mencetak.', true); return; }
        w.document.write(html);
        w.document.close();
        w.focus();
        setTimeout(() => { w.print(); }, 400);
    };

/* ===== AKHIR PART 5.5 ===== */
/* =====================================================================
   PART 6 dari 6: Kas & Bank, pengaturan, penutup file
   ===================================================================== */

    /* ---------- Kas & Bank ---------- */
    const EDITABLE_REFS = ['manual', 'adjustment'];
    async function loadCash() {
        const grid = document.getElementById('cashSourcesGrid');
        const body = document.getElementById('cashMutationsBody');
        const fail = msg => {
            if (grid) grid.innerHTML = `<div class="empty-state">${escapeHtml(msg)}</div>`;
            if (body) body.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-light)">${escapeHtml(msg)}</td></tr>`;
            showToast(msg, true);
        };
        try {
            const cashReq = ++cashRequestId;
            const { data, error: srcError } = await supabase.rpc('get_cash_sources');
            if (srcError) {
                console.error('Gagal memuat sumber kas:', srcError);
                const { data: s } = await supabase.auth.getSession();
                const ownerOk = state.currentUser?.role === 'owner' && state.authUserId && s?.session?.user?.id === state.authUserId;
                fail(ownerOk ? 'Data kas gagal dimuat. Periksa koneksi atau muat ulang halaman.' : 'Sesi Owner tidak aktif. Login kembali untuk membuka Kas & Bank.');
                if (!ownerOk && state.currentUser?.role === 'owner') await window.logout();
                return;
            }
            const sources = data || [];
            grid.innerHTML = sources.length ? sources.map(s => `<div class="cash-card"><h4><i class="fas fa-vault" style="color:var(--primary)"></i>${escapeHtml(s.name)}</h4><div class="balance">${formatRp(s.current_balance)}</div><div class="cash-card-actions"><button class="cash-action-btn primary" onclick="window.showCashAction('transfer','${s.id}')"><i class="fas fa-arrow-right-arrow-left"></i> Transfer</button><button class="cash-action-btn" onclick="window.showCashAction('physical','${s.id}')"><i class="fas fa-calculator"></i> Hitung Fisik</button></div></div>`).join('') : '<div class="empty-state">Belum ada sumber kas aktif.</div>';

            const start = document.getElementById('cashFilterStart')?.value;
            const end = document.getElementById('cashFilterEnd')?.value;
            let q = supabase.from('cash_mutations').select('*, cash_sources(name)').order('created_at', { ascending: false }).limit(200);
            if (start) q = q.gte('created_at', dayStartISO(start));
            if (end) q = q.lt('created_at', dayEndExclusiveISO(end));
            const { data: muts, error: mutError } = await q;
            if (cashReq !== cashRequestId) return;
            if (mutError) {
                console.error(mutError);
                body.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-light)">Saldo kas dimuat, tetapi riwayat mutasi gagal. Coba muat ulang.</td></tr>';
            } else {
                body.innerHTML = (muts || []).length ? muts.map(m => {
                    const editable = EDITABLE_REFS.includes(m.reference_type);
                    const isIn = m.type === 'in';
                    return `<tr><td>${new Date(m.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}</td><td><b>${escapeHtml(m.cash_sources?.name || '-')}</b></td><td><span class="badge badge-${isIn ? 'success' : 'warning'}"><i class="fas fa-${isIn ? 'arrow-down' : 'arrow-up'}"></i>${escapeHtml(m.type.toUpperCase())}</span></td><td>${escapeHtml(m.description || '-')}</td><td style="color:${isIn ? 'var(--primary)' : '#ef4444'};font-weight:800">${isIn ? '+' : '-'}${formatRp(m.amount)}</td><td class="mutation-action-btns"><button class="view-btn" onclick="window.viewMutationDetail('${m.id}')" title="Detail"><i class="fas fa-eye"></i></button><button class="edit-btn" onclick="window.editMutation('${m.id}')" title="${editable ? 'Edit' : 'Transaksi terkait dikunci'}" ${editable ? '' : 'disabled'}><i class="fas fa-pen"></i></button><button class="delete-mut-btn" onclick="window.deleteMutation('${m.id}')" title="${editable ? 'Hapus' : 'Transaksi terkait dikunci'}" ${editable ? '' : 'disabled'}><i class="fas fa-trash"></i></button></td></tr>`;
                }).join('') : '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-light)">Belum ada mutasi kas</td></tr>';
            }
            const opts = withBalance => sources.map(s => `<option value="${s.id}">${escapeHtml(s.name)}${withBalance ? ' (' + formatRp(s.current_balance) + ')' : ''}</option>`).join('');
            document.getElementById('transferFrom').innerHTML = opts(true);
            document.getElementById('transferTo').innerHTML = opts(false);
            document.getElementById('addMutationSource').innerHTML = opts(true);
        } catch (error) {
            console.error(error);
            fail('Kas & Bank gagal dimuat. Coba muat ulang halaman atau login kembali.');
        }
    }
    window.loadCash = loadCash;

    window.showAddMutationModal = function () {
        document.getElementById('addMutationAmount').value = '';
        document.getElementById('addMutationDesc').value = '';
        document.getElementById('addMutationModal').classList.add('active');
    };
    window.saveManualMutation = async function () {
        const sourceId = document.getElementById('addMutationSource').value;
        const amount = parseRp(document.getElementById('addMutationAmount').value);
        const desc = document.getElementById('addMutationDesc').value.trim();
        if (!sourceId) { showToast('Pilih sumber kas!', true); return; }
        if (amount <= 0) { showToast('Jumlah harus lebih dari 0!', true); return; }
        if (!desc) { showToast('Deskripsi wajib!', true); return; }
        const { data, error } = await supabase.rpc('add_manual_mutation', { p_source_id: sourceId, p_type: document.getElementById('addMutationType').value, p_amount: amount, p_description: desc, p_created_by: state.currentUser?.id || null });
        if (error || !data?.success) { showToast('Gagal: ' + (error?.message || data?.message || 'Unknown'), true); return; }
        showToast('Mutasi berhasil ditambahkan!');
        window.closeModal('addMutationModal');
        await loadCash();
    };

    async function doTransfer(from, to, amount, desc) {
        if (!from || !to || from === to) { showToast('Sumber & tujuan harus berbeda!', true); return false; }
        if (amount <= 0) { showToast('Jumlah wajib!', true); return false; }
        const { data, error } = await supabase.rpc('transfer_cash', { p_from: from, p_to: to, p_amount: amount, p_desc: desc, p_by: state.currentUser?.id || null });
        if (error || !data?.success) { showToast('Gagal: ' + (error?.message || data?.message || 'Unknown'), true); return false; }
        showToast('Transfer berhasil!');
        return true;
    }
    window.showTransferModal = function () {
        document.getElementById('transferAmount').value = '';
        document.getElementById('transferDesc').value = '';
        document.getElementById('transferModal').classList.add('active');
    };
    window.processTransfer = async function () {
        const ok = await doTransfer(document.getElementById('transferFrom').value, document.getElementById('transferTo').value, parseRp(document.getElementById('transferAmount').value), document.getElementById('transferDesc').value.trim());
        if (ok) { window.closeModal('transferModal'); await loadCash(); }
    };

    window.showCashAction = async function (action, sourceId) {
        const { data } = await supabase.rpc('get_cash_sources');
        const sources = data || [];
        const src = sources.find(s => s.id === sourceId);
        if (!src) { showToast('Sumber kas tidak ditemukan', true); return; }
        const content = document.getElementById('cashActionContent');
        document.getElementById('cashActionTitle').innerText = action === 'transfer' ? `Transfer dari ${src.name}` : `Hitung Fisik - ${src.name}`;
        content.innerHTML = action === 'transfer'
            ? `<div class="input-group"><label>Ke Sumber</label><select id="cashActionTo">${sources.filter(s => s.id !== sourceId).map(s => `<option value="${s.id}">${escapeHtml(s.name)} (${formatRp(s.current_balance)})</option>`).join('')}</select></div><div class="input-group"><label>Jumlah (Rp)</label><input type="text" inputmode="numeric" class="rp-input" id="cashActionAmount" placeholder="0"></div><div class="input-group"><label>Keterangan</label><input type="text" id="cashActionDesc" placeholder="Keterangan transfer"></div><button class="add-to-cart-btn" onclick="window.processCashAction('transfer','${sourceId}')">Transfer Sekarang</button>`
            : `<div class="input-group"><label>Saldo Sistem</label><input type="text" readonly value="${formatRp(src.current_balance)}"></div><div class="input-group"><label>Hitung Fisik (Rp)</label><input type="text" inputmode="numeric" class="rp-input" id="cashActionPhysical" placeholder="0"></div><div class="input-group"><label>Keterangan</label><input type="text" id="cashActionDesc" placeholder="Selisih otomatis dicatat"></div><button class="add-to-cart-btn" onclick="window.processCashAction('physical','${sourceId}')">Simpan</button>`;
        document.getElementById('cashActionModal').classList.add('active');
    };
    window.processCashAction = async function (action, sourceId) {
        const desc = document.getElementById('cashActionDesc')?.value.trim() || '';
        if (action === 'transfer') {
            const ok = await doTransfer(sourceId, document.getElementById('cashActionTo')?.value, parseRp(document.getElementById('cashActionAmount')?.value), desc);
            if (!ok) return;
        } else {
            const raw = document.getElementById('cashActionPhysical')?.value;
            const physical = parseRp(raw);
            if (raw === '' || !Number.isFinite(physical) || physical < 0) { showToast('Masukkan hitung fisik yang valid!', true); return; }
            const { data, error } = await supabase.rpc('reconcile_cash_balance', { p_source_id: sourceId, p_physical_balance: physical, p_description: desc });
            if (error || !data?.success) { showToast('Gagal menyimpan hitung fisik: ' + (error?.message || data?.message || 'Unknown'), true); return; }
            showToast(data.no_change ? 'Saldo fisik sudah sesuai dengan saldo sistem.' : 'Hitung fisik disimpan dan selisih dicatat.');
        }
        window.closeModal('cashActionModal');
        await loadCash();
    };

    window.viewMutationDetail = async function (id) {
        const { data: m } = await supabase.from('cash_mutations').select('*, cash_sources(name)').eq('id', id).single();
        if (!m) { showToast('Mutasi tidak ditemukan', true); return; }
        const row = (l, v) => `<div class="mutation-detail-row"><span class="mutation-detail-label">${l}</span><span class="mutation-detail-value">${v}</span></div>`;
        let related = '';
        if (m.reference_type === 'sale') {
            const { data: o } = await supabase.from('orders').select('order_number,customer_name,payment_method').eq('id', m.reference_id).single();
            if (o) related = row('No. Order', escapeHtml(o.order_number)) + row('Customer', escapeHtml(o.customer_name || 'Walk-in')) + row('Metode Bayar', escapeHtml((o.payment_method || 'cash').toUpperCase()));
        } else if (m.reference_type === 'expense') {
            const { data: x } = await supabase.from('expenses').select('category,description').eq('id', m.reference_id).single();
            if (x) related = row('Kategori', escapeHtml(x.category)) + row('Deskripsi', escapeHtml(x.description || '-'));
        } else if (m.reference_type) {
            related = row('Jenis', escapeHtml(String(m.reference_type).toUpperCase())) + (m.reference_type === 'transfer' ? row('Posisi', m.type === 'out' ? 'Sumber Transfer' : 'Tujuan Transfer') : '');
        }
        const isIn = m.type === 'in';
        document.getElementById('mutationDetailContent').innerHTML =
            row('Tanggal & Waktu', new Date(m.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })) + row('Sumber Kas', escapeHtml(m.cash_sources?.name || '-')) +
            row('Tipe', `<span class="badge badge-${isIn ? 'success' : 'warning'}">${escapeHtml(m.type.toUpperCase())}</span>`) +
            `<div class="mutation-detail-row"><span class="mutation-detail-label">Jumlah</span><span class="mutation-detail-value" style="color:${isIn ? 'var(--primary)' : '#ef4444'};font-size:18px">${isIn ? '+' : '-'}${formatRp(m.amount)}</span></div>` +
            row('Deskripsi', escapeHtml(m.description || '-')) +
            (related ? `<div style="margin-top:20px;padding-top:20px;border-top:2px solid var(--border)"><h4 style="margin-bottom:12px;font-size:14px;color:var(--primary-dark)">Informasi Terkait</h4>${related}</div>` : '');
        document.getElementById('mutationDetailModal').classList.add('active');
    };
    window.editMutation = async function (id) {
        const { data: m } = await supabase.from('cash_mutations').select('*').eq('id', id).single();
        if (!m) { showToast('Mutasi tidak ditemukan', true); return; }
        if (!EDITABLE_REFS.includes(m.reference_type)) { showToast('Hanya mutasi manual/adjustment yang bisa diedit', true); return; }
        document.getElementById('editMutationId').value = id;
        document.getElementById('editMutationAmount').value = fmtRp(m.amount);
        document.getElementById('editMutationDesc').value = m.description || '';
        document.getElementById('editMutationModal').classList.add('active');
    };
    window.saveEditedMutation = async function () {
        const amount = parseRp(document.getElementById('editMutationAmount').value);
        if (amount <= 0) { showToast('Jumlah wajib!', true); return; }
        const { data, error } = await supabase.rpc('update_cash_mutation', { p_mutation_id: document.getElementById('editMutationId').value, p_new_amount: amount, p_new_description: document.getElementById('editMutationDesc').value.trim() });
        if (error || !data?.success) { showToast('Gagal: ' + (error?.message || data?.message || 'Unknown'), true); return; }
        showToast('Mutasi berhasil diupdate!');
        window.closeModal('editMutationModal');
        await loadCash();
    };
    window.deleteMutation = async function (id) {
        if (!(await confirmDialog('Saldo dan jurnal terkait akan dibalik.', { title: 'Hapus mutasi', okText: 'Hapus', danger: true }))) return;
        const { data, error } = await supabase.rpc('delete_cash_mutation', { p_mutation_id: id });
        if (error || !data?.success) { showToast('Gagal: ' + (error?.message || data?.message || 'Unknown'), true); return; }
        showToast('Mutasi berhasil dihapus!');
        await loadCash();
    };

    /* ---------- Pengaturan ---------- */
    async function loadSettings() {
        const tab = state.settingsTab || 'profile';
        const content = document.getElementById('settingsContent');
        if (tab === 'profile') {
            const u = state.currentUser;
            content.innerHTML = `<div class="profile-section"><h3 style="margin-bottom:16px"><i class="fas fa-user-circle" style="color:var(--primary);margin-right:8px"></i>Profil Saya</h3><div class="profile-photo-section"><div class="profile-photo-preview" onclick="window.openPhotoUpload()">${u?.avatar_url && (u.avatar_url.startsWith('http') || u.avatar_url.startsWith('data:image')) ? `<img src="${escapeHtml(u.avatar_url)}" alt="Profil">` : '<i class="fas fa-user"></i>'}</div><div style="flex:1"><p style="font-size:13px;color:var(--text-light);margin-bottom:8px">Klik foto untuk upload</p><button class="btn-secondary" onclick="window.openPhotoUpload()"><i class="fas fa-camera"></i> Upload Foto</button></div></div><div class="input-group"><label>Nama Lengkap</label><input type="text" id="profileFullName" value="${escapeHtml(u?.full_name || '')}"></div><div class="input-group"><label>Password Baru</label><div class="password-wrapper"><input type="password" id="profilePassword" placeholder="Kosongkan jika tidak diubah"><button type="button" class="password-toggle" onclick="window.toggleFieldPassword('profilePassword', this)"><i class="fas fa-eye"></i></button></div></div><button class="btn-primary" onclick="window.saveProfile()"><i class="fas fa-save"></i> Simpan Profil</button></div>`;
        } else if (tab === 'users') {
            const { data } = await supabase.from('app_users').select('id, username, full_name, role').eq('is_active', true).order('full_name');
            content.innerHTML = `<div class="profile-section"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h3><i class="fas fa-users" style="color:var(--primary);margin-right:8px"></i>Manajemen User</h3><button class="btn-primary" onclick="window.showUserForm()"><i class="fas fa-plus"></i> Tambah User</button></div><div class="user-list">${(data || []).map(u => `<div class="user-list-item"><div class="user-list-info"><div class="user-avatar">${escapeHtml(u.full_name.charAt(0).toUpperCase())}</div><div><div class="user-name">${escapeHtml(u.full_name)}</div><div class="user-role">@${escapeHtml(u.username)} • ${escapeHtml(u.role)}</div></div></div><div class="user-list-actions"><button class="btn-secondary" style="padding:6px 10px;font-size:11px" onclick="window.editUser('${u.id}')"><i class="fas fa-edit"></i></button><button class="btn-secondary" style="padding:6px 10px;font-size:11px;color:#ef4444" onclick="window.deleteUser('${u.id}')"><i class="fas fa-trash"></i></button></div></div>`).join('')}</div></div>`;
        } else {
            const { data } = await supabase.from('settings').select('*');
            const s = {};
            (data || []).forEach(r => { s[r.key] = r.value; });
            if (tab === 'store') {
                const st = s.store_info || {};
                content.innerHTML = `<div class="settings-card"><h3><i class="fas fa-store"></i> Info Toko</h3><div class="input-group"><label>Nama Toko</label><input type="text" id="settingStoreName" value="${escapeHtml(st.name || 'MasuSpace Coffee')}"></div><div class="input-group"><label>Alamat</label><input type="text" id="settingAddress" value="${escapeHtml(st.address || '')}"></div><div class="input-group"><label>Telepon</label><input type="text" id="settingPhone" value="${escapeHtml(st.phone || '')}"></div><div class="input-group"><label>Email</label><input type="email" id="settingEmail" value="${escapeHtml(st.email || '')}"></div><button class="btn-primary" onclick="window.saveSettings('store_info')"><i class="fas fa-save"></i> Simpan</button></div>`;
            } else if (tab === 'printer') {
                const isUSB = state.printer.type === 'usb';
                const isBT = state.printer.type === 'bluetooth';
                const connected = !!state.printer.device;
                const supportsUSB = !!(navigator.usb);
                const supportsBT = !!(navigator.bluetooth);
                content.innerHTML = `
                    <div class="settings-card">
                        <h3><i class="fas fa-print" style="color:var(--primary)"></i> Hubungkan Printer Thermal</h3>
                        <p style="font-size:13px;color:var(--text-light);margin-bottom:16px;line-height:1.6">Hubungkan printer thermal <b>USB</b> atau <b>Bluetooth</b> untuk cetak struk langsung dari browser tanpa instal driver. Setelah terhubung sekali, browser mengingat printer dan akan <b>otomatis menyambung ulang</b> saat aplikasi dibuka atau printer dinyalakan kembali.</p>
                        
                        <div class="printer-status-card ${connected ? 'connected' : 'disconnected'}">
                            <div class="printer-status-icon"><i class="fas fa-${isUSB ? 'plug' : isBT ? 'bluetooth-b' : 'print'}"></i></div>
                            <div class="printer-status-info">
                                <div class="printer-status-label">Status Printer</div>
                                <div class="printer-status-value">${connected ? 'Terhubung' : 'Belum Terhubung'}</div>
                                ${state.printer.name ? `<div class="printer-status-device">${escapeHtml(state.printer.name)} • ${isUSB ? 'USB' : 'Bluetooth'}</div>` : '<div class="printer-status-device">Pilih jenis koneksi di bawah</div>'}
                            </div>
                        </div>
                        
                        <div class="printer-actions">
                            <button class="btn-primary" onclick="window.connectUSBPrinter()" ${supportsUSB ? '' : 'disabled'} title="${supportsUSB ? 'Hubungkan via Web USB' : 'Browser tidak mendukung Web USB'}"><i class="fas fa-plug"></i> Hubungkan USB</button>
                            <button class="btn-primary" onclick="window.connectBluetoothPrinter()" ${supportsBT ? '' : 'disabled'} title="${supportsBT ? 'Hubungkan via Web Bluetooth' : 'Browser tidak mendukung Web Bluetooth'}"><i class="fab fa-bluetooth-b"></i> Hubungkan Bluetooth</button>
                        </div>
                        
                        ${connected ? `
                            <div class="printer-actions">
                                <button class="btn-secondary" onclick="window.testPrint()"><i class="fas fa-flask"></i> Tes Print</button>
                                <button class="btn-secondary" style="color:#ef4444;border-color:#fecaca" onclick="window.disconnectPrinter()"><i class="fas fa-unlink"></i> Putuskan</button>
                            </div>
                        ` : ''}
                        
                        <div style="margin-top:16px;font-size:12px;color:var(--text-light);line-height:1.7">
                            <p style="font-weight:700;margin-bottom:8px;color:var(--text)">Persyaratan koneksi:</p>
                            <ul style="padding-left:20px;display:grid;gap:6px">
                                <li>Browser <b>Chrome</b> atau <b>Edge</b> versi terbaru (desktop/Android)</li>
                                <li>Akses aplikasi via <b>HTTPS</b> (bukan HTTP)</li>
                                <li>USB: printer thermal dengan kabel USB</li>
                                <li>Bluetooth: printer thermal yang support BLE</li>
                                <li>Saat dialog muncul, pilih printer lalu klik "Hubungkan"</li>
                            </ul>
                        </div>
                        
                        <div class="printer-tip">
                            <i class="fas fa-circle-info"></i>
                            <b>Auto-reconnect aktif.</b> Setelah berhasil terhubung, browser mengingat izin printer. Aplikasi akan menyambung ulang otomatis jika: (1) halaman dimuat ulang, (2) printer dicabut lalu dicolok lagi, (3) Bluetooth dimatikan lalu dinyalakan lagi. Tidak perlu klik "Hubungkan" berulang kali.
                        </div>
                        
                        ${!supportsUSB && !supportsBT ? `<div class="printer-warn"><i class="fas fa-triangle-exclamation"></i>Browser ini tidak mendukung Web USB / Web Bluetooth. Gunakan Chrome atau Edge terbaru via HTTPS untuk mengaktifkan fitur ini.</div>` : ''}
                    </div>
                `;
            } else {
                const tax = s.tax || {};
                content.innerHTML = `<div class="settings-card"><h3><i class="fas fa-percent"></i> Pajak</h3><div class="input-group"><label>Aktifkan Pajak</label><select id="settingTaxEnabled"><option value="true" ${tax.enabled ? 'selected' : ''}>Ya</option><option value="false" ${!tax.enabled ? 'selected' : ''}>Tidak</option></select></div><div class="input-group"><label>Rate (%)</label><input type="number" id="settingTaxRate" min="0" max="100" value="${Number(tax.rate || 0)}"></div><p style="font-size:12px;color:var(--text-light);margin-bottom:10px">Catatan: pajak belum dihitung di kasir (tax = 0).</p><button class="btn-primary" onclick="window.saveSettings('tax')"><i class="fas fa-save"></i> Simpan</button></div>`;
            }
        }
    }
    window.loadSettings = loadSettings;
    window.switchSettingsTab = function (tab, btn) {
        state.settingsTab = tab;
        document.querySelectorAll('#page-settings .tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        loadSettings();
    };
    // Hanya menyimpan tab yang sedang dibuka agar tidak menimpa pengaturan lain
    window.saveSettings = async function (key) {
        const value = key === 'store_info'
            ? { name: document.getElementById('settingStoreName').value.trim() || 'MasuSpace Coffee', address: document.getElementById('settingAddress').value.trim(), phone: document.getElementById('settingPhone').value.trim(), email: document.getElementById('settingEmail').value.trim() }
            : { enabled: document.getElementById('settingTaxEnabled').value === 'true', rate: Math.min(Math.max(parseFloat(document.getElementById('settingTaxRate').value) || 0, 0), 100) };
        const { error } = await supabase.rpc('save_setting', { p_key: key, p_value: value });
        if (error) { showToast('Gagal: ' + error.message, true); return; }
        showToast('Pengaturan disimpan!');
    };

    window.openPhotoUpload = function () { state.pendingPhotoBase64 = null; document.getElementById('photoUploadModal').classList.add('active'); };
    window.handlePhotoUpload = function (event) {
        const file = event.target.files[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) { showToast('Ukuran file maksimal 2MB!', true); return; }
        if (!file.type.startsWith('image/')) { showToast('Hanya file gambar!', true); return; }
        const reader = new FileReader();
        reader.onload = e => {
            const img = new Image();
            img.onload = () => {
                const s = 256, c = document.createElement('canvas'), m = Math.min(img.width, img.height), ctx = c.getContext('2d');
                c.width = c.height = s; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, s, s);
                ctx.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, s, s);
                const data = c.toDataURL('image/jpeg', 0.85);
                state.pendingPhotoBase64 = data;
                document.getElementById('photoUploadPreview').innerHTML = `<img src="${data}" alt="Preview">`;
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    };
    window.saveUploadedPhoto = async function () {
        if (!state.pendingPhotoBase64) { showToast('Pilih foto dulu!', true); return; }
        const { error } = await supabase.from('app_users').update({ avatar_url: state.pendingPhotoBase64 }).eq('id', state.currentUser.id);
        if (error) { showToast('Gagal: ' + error.message, true); return; }
        state.currentUser.avatar_url = state.pendingPhotoBase64;
        if (state.currentUser.role === 'owner') { try { localStorage.setItem('masuspace-logo', state.pendingPhotoBase64); } catch (e) { /* kuota penuh */ } applyBrandLogo(state.pendingPhotoBase64); }
        setAvatar(document.getElementById('userAvatar'), state.currentUser);
        setAvatar(document.getElementById('userAvatar2'), state.currentUser);
        state.pendingPhotoBase64 = null;
        showToast('Foto profil diupdate!');
        window.closeModal('photoUploadModal');
        loadSettings();
    };
    window.saveProfile = async function () {
        const fullName = document.getElementById('profileFullName').value.trim();
        const password = document.getElementById('profilePassword').value;
        if (!fullName) { showToast('Nama wajib!', true); return; }
        if (password && password.length < 6) { showToast('Password minimal 6 karakter.', true); return; }
        const { error } = await supabase.from('app_users').update({ full_name: fullName }).eq('id', state.currentUser.id);
        if (error) { showToast('Gagal: ' + error.message, true); return; }
        // Password Owner ada di Supabase Auth, bukan di tabel app_users
        if (password) {
            const { error: pwError } = await supabase.auth.updateUser({ password });
            if (pwError) { showToast('Nama tersimpan, tetapi password gagal diubah: ' + pwError.message, true); return; }
            document.getElementById('profilePassword').value = '';
        }
        state.currentUser = { ...state.currentUser, full_name: fullName };
        ['userName', 'userName2'].forEach(id => { document.getElementById(id).innerText = fullName; });
        setAvatar(document.getElementById('userAvatar'), state.currentUser);
        setAvatar(document.getElementById('userAvatar2'), state.currentUser);
        showToast('Profil disimpan!');
    };

    window.showUserForm = function () {
        document.getElementById('userFormTitle').innerText = 'Tambah User';
        ['editUserId', 'editUserFullName', 'editUserUsername', 'editUserPassword'].forEach(id => { document.getElementById(id).value = ''; });
        document.getElementById('editUserRole').value = 'kasir';
        document.getElementById('editUserPassword').type = 'password';
        document.getElementById('userFormModal').classList.add('active');
    };
    window.editUser = async function (id) {
        const { data } = await supabase.from('app_users').select('id, username, full_name, role, password_hash').eq('id', id).single();
        if (!data) return;
        document.getElementById('userFormTitle').innerText = 'Edit User';
        document.getElementById('editUserId').value = data.id;
        document.getElementById('editUserFullName').value = data.full_name;
        document.getElementById('editUserUsername').value = data.username;
        // Password kasir tersimpan apa adanya, jadi bisa dilihat lewat tombol mata. Password Owner ada di Supabase Auth.
        document.getElementById('editUserPassword').value = data.role === 'kasir' ? (data.password_hash || '') : '';
        document.getElementById('editUserPassword').type = 'password';
        document.getElementById('editUserRole').value = data.role;
        document.getElementById('userFormModal').classList.add('active');
    };
    window.saveUser = async function () {
        const id = document.getElementById('editUserId').value || null;
        const fullName = document.getElementById('editUserFullName').value.trim();
        const username = document.getElementById('editUserUsername').value.trim();
        const password = document.getElementById('editUserPassword').value;
        const role = document.getElementById('editUserRole').value;
        if (!fullName || !username) { showToast('Nama dan username wajib!', true); return; }
        if (!id && !password) { showToast('Password wajib untuk user baru!', true); return; }
        const userData = { full_name: fullName, username, role };
        if (password) userData.password_hash = password;
        const { error } = id ? await supabase.from('app_users').update(userData).eq('id', id) : await supabase.from('app_users').insert({ ...userData, is_active: true });
        if (error) { showToast('Gagal: ' + (error.code === '23505' ? 'Username sudah dipakai.' : error.message), true); return; }
        showToast('User disimpan!');
        window.closeModal('userFormModal');
        await loadSettings();
        await loadUsersToDropdown();
    };
    window.deleteUser = async function (id) {
        if (id === state.currentUser.id) { showToast('Tidak bisa hapus user sendiri!', true); return; }
        if (!(await confirmDialog('User ini tidak bisa login lagi.', { title: 'Hapus user', okText: 'Hapus', danger: true }))) return;
        const { error } = await supabase.from('app_users').update({ is_active: false }).eq('id', id);
        if (error) { showToast('Gagal: ' + error.message, true); return; }
        showToast('User dihapus');
        await loadSettings();
        await loadUsersToDropdown();
    };

    /* ---------- Lupa password ---------- */
    window.forgotPassword = async function () {
        const username = document.getElementById('loginUsername').value.trim();
        if (!username) { showToast('Ketik username dulu, lalu klik Lupa password.', true); return; }
        const { data: found } = await supabase.from('app_users').select('role').eq('username', username).eq('is_active', true).maybeSingle();
        if (!found) { showToast('Username tidak ditemukan.', true); return; }
        if (found.role !== 'owner') { showToast('Password kasir direset oleh Owner di Pengaturan → User.', true); return; }
        if (!OWNER_AUTH_EMAIL.includes('@')) { showToast('Email Owner belum diisi di main.js (OWNER_AUTH_EMAIL).', true); return; }
        const masked = OWNER_AUTH_EMAIL.replace(/^(.).*(@.*)$/, '$1***$2');
        if (!(await confirmDialog(`Link reset password akan dikirim ke ${masked}.`, { title: 'Reset password Owner', okText: 'Kirim link' }))) return;
        const { error } = await supabase.auth.resetPasswordForEmail(OWNER_AUTH_EMAIL, { redirectTo: window.location.origin + window.location.pathname });
        if (error) { showToast(/rate|seconds|limit/i.test(error.message) ? 'Terlalu sering meminta link. Tunggu beberapa menit lalu coba lagi.' : 'Gagal mengirim: ' + error.message, true); return; }
        showToast('Link reset dikirim ke ' + masked + '. Cek inbox dan spam.');
    };
    window.openResetModal = function () {
        document.getElementById('newPassword').value = '';
        document.getElementById('newPassword2').value = '';
        document.getElementById('resetPasswordModal').classList.add('active');
    };
    window.saveRecoveredPassword = async function () {
        const p1 = document.getElementById('newPassword').value;
        const p2 = document.getElementById('newPassword2').value;
        if (p1.length < 8) { showToast('Password minimal 8 karakter.', true); return; }
        if (p1 !== p2) { showToast('Kedua password tidak sama.', true); return; }
        const { error } = await supabase.auth.updateUser({ password: p1 });
        if (error) { showToast('Gagal menyimpan: ' + error.message, true); return; }
        await supabase.auth.signOut();
        history.replaceState(null, '', window.location.pathname);
        window.closeModal('resetPasswordModal');
        document.getElementById('loginPassword').value = '';
        showToast('Password berhasil diubah. Silakan login dengan password baru.');
    };
    window.cancelReset = async function () {
        await supabase.auth.signOut();
        history.replaceState(null, '', window.location.pathname);
        window.closeModal('resetPasswordModal');
    };

    /* ---------- Menu, Kategori, Stok ---------- */
    const val = id => document.getElementById(id).value.trim();
    const emptyRow = (cols, msg) => `<tr><td colspan="${cols}" style="text-align:center;padding:30px;color:var(--text-light)">${msg}</td></tr>`;
    const refreshKasirCache = () => { state.categories = []; };
    const actionBtns = (edit, del, extra = '') => `<td class="mutation-action-btns">${extra}<button class="edit-btn" onclick="${edit}" title="Edit"><i class="fas fa-pen"></i></button><button class="delete-mut-btn" onclick="${del}" title="Hapus"><i class="fas fa-trash"></i></button></td>`;
    async function runSave(promise, okMsg, closeId, reload) {
        const { error } = await promise;
        if (error) { showToast('Gagal: ' + error.message, true); return; }
        showToast(okMsg); window.closeModal(closeId); refreshKasirCache(); await reload();
    }

    async function loadMenuHub() {
        const tab = state.menuTab || 'menu';
        document.querySelectorAll('.menu-panel').forEach(p => { p.style.display = p.id === 'panel-' + tab ? '' : 'none'; });
        await ({ menu: loadMenuPage, categories: loadCategoriesPage, inventory: loadInventoryPage })[tab]();
    }
    window.switchMenuTab = function (tab, btn) {
        state.menuTab = tab;
        document.querySelectorAll('#page-menu > .tabs .tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        loadMenuHub().catch(e => showToast('Gagal memuat: ' + e.message, true));
    };

    async function loadMenuPage() {
        const [cats, prods] = await Promise.all([
            supabase.from('categories').select('*').eq('is_active', true).order('display_order'),
            supabase.from('products').select('*').eq('is_active', true).order('display_order')
        ]);
        if (prods.error) throw prods.error;
        state.menuCats = cats.data || []; state.menuProducts = prods.data || [];
        const catName = new Map(state.menuCats.map(c => [c.id, (c.icon || '') + ' ' + c.name]));
        document.getElementById('menuTableBody').innerHTML = state.menuProducts.length ? state.menuProducts.map(p => `<tr><td><b>${escapeHtml(p.name)}</b></td><td>${escapeHtml(catName.get(p.category_id) || '-')}</td><td>${formatRp(p.base_price)}</td>${actionBtns(`window.editProduct('${p.id}')`, `window.deleteProduct('${p.id}')`, `<button class="view-btn" onclick="window.showRecipeModal('${p.id}')" title="Resep"><i class="fas fa-flask"></i></button>`)}</tr>`).join('') : emptyRow(4, 'Belum ada menu');
    }
    function fillProductForm(p) {
        document.getElementById('editProductId').value = p?.id || '';
        document.getElementById('editProductName').value = p?.name || '';
        document.getElementById('editProductPrice').value = p ? fmtRp(p.base_price) : '';
        document.getElementById('editProductDesc').value = p?.description || '';
        document.getElementById('editProductCategory').innerHTML = '<option value="">Tanpa kategori</option>' + (state.menuCats || []).map(c => `<option value="${c.id}" ${p?.category_id === c.id ? 'selected' : ''}>${escapeHtml((c.icon || '') + ' ' + c.name)}</option>`).join('');
        document.getElementById('productFormModal').classList.add('active');
    }
    window.showProductForm = () => fillProductForm(null);
    window.editProduct = id => fillProductForm((state.menuProducts || []).find(p => p.id === id));
    window.saveProduct = async function () {
        const id = val('editProductId'), name = val('editProductName'), price = parseRp(val('editProductPrice'));
        if (!name || val('editProductPrice') === '') { showToast('Nama dan harga wajib diisi!', true); return; }
        const row = { name, category_id: document.getElementById('editProductCategory').value || null, base_price: price, description: val('editProductDesc') };
        await runSave(id ? supabase.from('products').update({ ...row, updated_at: new Date().toISOString() }).eq('id', id) : supabase.from('products').insert({ ...row, is_active: true }), 'Menu disimpan!', 'productFormModal', loadMenuPage);
    };
    window.deleteProduct = async function (id) {
        if (!(await confirmDialog('Menu ini tidak akan tampil lagi di kasir. Riwayat penjualan tetap aman.', { title: 'Hapus menu', okText: 'Hapus', danger: true }))) return;
        const { error } = await supabase.from('products').update({ is_active: false }).eq('id', id);
        if (error) { showToast('Gagal: ' + error.message, true); return; }
        showToast('Menu dihapus'); refreshKasirCache(); loadMenuPage();
    };

    async function loadCategoriesPage() {
        const [cats, prods] = await Promise.all([
            supabase.from('categories').select('*').eq('is_active', true).order('display_order'),
            supabase.from('products').select('category_id').eq('is_active', true)
        ]);
        if (cats.error) throw cats.error;
        state.menuCats = cats.data || [];
        const count = {}; (prods.data || []).forEach(p => { count[p.category_id] = (count[p.category_id] || 0) + 1; });
        document.getElementById('categoryTableBody').innerHTML = state.menuCats.length ? state.menuCats.map(c => `<tr><td style="font-size:20px">${escapeHtml(c.icon || '')}</td><td><b>${escapeHtml(c.name)}</b></td><td>${count[c.id] || 0}</td>${actionBtns(`window.editCategory('${c.id}')`, `window.deleteCategory('${c.id}')`)}</tr>`).join('') : emptyRow(4, 'Belum ada kategori');
    }
    function fillCategoryForm(c) {
        document.getElementById('editCategoryId').value = c?.id || '';
        document.getElementById('editCategoryName').value = c?.name || '';
        document.getElementById('editCategoryIcon').value = c?.icon || '';
        document.getElementById('categoryFormModal').classList.add('active');
    }
    window.showCategoryForm = () => fillCategoryForm(null);
    window.editCategory = id => fillCategoryForm((state.menuCats || []).find(c => c.id === id));
    window.saveCategory = async function () {
        const id = val('editCategoryId'), name = val('editCategoryName');
        if (!name) { showToast('Nama kategori wajib!', true); return; }
        const row = { name, icon: val('editCategoryIcon') };
        await runSave(id ? supabase.from('categories').update(row).eq('id', id) : supabase.from('categories').insert({ ...row, is_active: true, display_order: 99 }), 'Kategori disimpan!', 'categoryFormModal', loadCategoriesPage);
    };
    window.deleteCategory = async function (id) {
        if (!(await confirmDialog('Menu di kategori ini tidak ikut terhapus, tetapi akan tanpa kategori.', { title: 'Hapus kategori', okText: 'Hapus', danger: true }))) return;
        const { error } = await supabase.from('categories').update({ is_active: false }).eq('id', id);
        if (error) { showToast('Gagal: ' + error.message, true); return; }
        showToast('Kategori dihapus'); refreshKasirCache(); loadCategoriesPage();
    };

    async function loadInventoryPage() {
        const { data, error } = await supabase.from('ingredients').select('*').eq('is_active', true).order('name');
        if (error) throw error;
        state.ingredients = data || [];
        const st = i => Number(i.stock_qty) <= 0 ? ['Habis', 'danger'] : Number(i.stock_qty) <= Number(i.min_stock) ? ['Menipis', 'warning'] : ['Aman', 'success'];
        const low = state.ingredients.filter(i => st(i)[1] === 'warning').length, out = state.ingredients.filter(i => st(i)[1] === 'danger').length;
        const value = state.ingredients.reduce((s, i) => s + Number(i.stock_qty) * Number(i.buy_price), 0);
        const card = (l, v) => `<div class="stat-card"><div class="stat-info"><div class="stat-label">${l}</div><div class="stat-value">${v}</div></div></div>`;
        document.getElementById('invStats').innerHTML = card('Total Bahan', state.ingredients.length) + card('Menipis', low) + card('Habis', out) + card('Nilai Stok', formatRp(value));
        document.getElementById('ingredientsTableBody').innerHTML = state.ingredients.length ? state.ingredients.map(i => { const [label, cls] = st(i); return `<tr><td><b>${escapeHtml(i.name)}</b></td><td>${Number(i.stock_qty)}</td><td>${Number(i.min_stock)}</td><td>${escapeHtml(i.unit)}</td><td>${formatRp(i.buy_price)}</td><td><b>${formatRp(i.stock_qty * i.buy_price)}</b></td><td>${escapeHtml(i.supplier || '-')}</td><td><span class="badge badge-${cls}">${label}</span></td>${actionBtns(`window.editIngredient('${i.id}')`, `window.deleteIngredient('${i.id}')`)}</tr>`; }).join('') : emptyRow(9, 'Belum ada data bahan baku');
    }
    function fillIngredientForm(i) {
        const set = (id, v) => { document.getElementById(id).value = v; };
        set('editIngredientId', i?.id || ''); set('editIngredientName', i?.name || ''); set('editIngredientStock', i?.stock_qty ?? '');
        set('editIngredientUnit', i?.unit || 'gram'); set('editIngredientMin', i?.min_stock ?? ''); set('editIngredientPrice', i ? fmtRp(i.buy_price) : ''); set('editIngredientSupplier', i?.supplier || '');
        document.getElementById('ingredientFormModal').classList.add('active');
    }
    window.showIngredientForm = () => fillIngredientForm(null);
    window.editIngredient = id => fillIngredientForm((state.ingredients || []).find(i => i.id === id));
    window.saveIngredient = async function () {
        const id = val('editIngredientId'), name = val('editIngredientName');
        if (!name) { showToast('Nama bahan wajib!', true); return; }
        const n = f => parseFloat(val(f)) || 0;
        const row = { name, stock_qty: n('editIngredientStock'), unit: val('editIngredientUnit') || 'gram', min_stock: n('editIngredientMin'), buy_price: parseRp(val('editIngredientPrice')), supplier: val('editIngredientSupplier') };
        await runSave(id ? supabase.from('ingredients').update({ ...row, updated_at: new Date().toISOString() }).eq('id', id) : supabase.from('ingredients').insert({ ...row, is_active: true }), 'Bahan disimpan!', 'ingredientFormModal', loadInventoryPage);
    };
    window.deleteIngredient = async function (id) {
        if (!(await confirmDialog('Bahan ini disembunyikan dari daftar stok.', { title: 'Hapus bahan', okText: 'Hapus', danger: true }))) return;
        const { error } = await supabase.from('ingredients').update({ is_active: false }).eq('id', id);
        if (error) { showToast('Gagal: ' + error.message, true); return; }
        showToast('Bahan dihapus'); loadInventoryPage();
    };

    window.showRecipeModal = async function (productId) {
        const p = (state.menuProducts || []).find(x => x.id === productId);
        if (!p) return;
        document.getElementById('recipeContent').innerHTML = '<div style="text-align:center;padding:20px">Memuat...</div>';
        document.getElementById('recipeModal').classList.add('active');
        const [rec, ing] = await Promise.all([supabase.rpc('get_product_recipes', { p_product_id: productId }), supabase.from('ingredients').select('id,name,unit').eq('is_active', true).order('name')]);
        const list = rec.data || [];
        document.getElementById('recipeContent').innerHTML = `<h4 style="margin-bottom:12px">Resep: ${escapeHtml(p.name)}</h4><div style="max-height:260px;overflow-y:auto;margin-bottom:14px">${list.length ? list.map(r => `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;background:var(--bg)"><span><b>${escapeHtml(r.ingredient_name)}</b> · ${Number(r.qty_needed)} ${escapeHtml(r.unit)}</span><button class="btn-secondary" style="color:#ef4444;padding:4px 8px" onclick="window.deleteRecipe('${r.id}','${productId}')"><i class="fas fa-trash"></i></button></div>`).join('') : '<p style="text-align:center;color:var(--text-light);padding:16px">Belum ada resep</p>'}</div><div style="display:flex;gap:8px;padding:12px;background:var(--primary-50);border:1px solid var(--primary);border-radius:8px"><select id="recipeIngredient" style="flex:2;padding:8px;border-radius:6px;border:1px solid var(--border)"><option value="">Pilih bahan</option>${(ing.data || []).map(i => `<option value="${i.id}">${escapeHtml(i.name)} (${escapeHtml(i.unit)})</option>`).join('')}</select><input type="number" id="recipeQty" placeholder="Jumlah" step="0.01" min="0" style="flex:1;min-width:0;padding:8px;border-radius:6px;border:1px solid var(--border)"><button class="btn-primary" onclick="window.addRecipe('${productId}')"><i class="fas fa-plus"></i></button></div>`;
    };
    window.addRecipe = async function (productId) {
        const ingredientId = document.getElementById('recipeIngredient').value, qty = parseFloat(document.getElementById('recipeQty').value) || 0;
        if (!ingredientId || qty <= 0) { showToast('Pilih bahan dan isi jumlah!', true); return; }
        const { data, error } = await supabase.rpc('save_recipe', { p_product_id: productId, p_ingredient_id: ingredientId, p_qty_needed: qty });
        if (error || !data?.success) { showToast('Gagal: ' + (error?.message || data?.message || 'Unknown'), true); return; }
        showToast('Resep ditambahkan!'); window.showRecipeModal(productId);
    };
    window.deleteRecipe = async function (recipeId, productId) {
        const { data, error } = await supabase.rpc('delete_recipe', { p_id: recipeId });
        if (error || !data?.success) { showToast('Gagal: ' + (error?.message || data?.message || 'Unknown'), true); return; }
        showToast('Resep dihapus!'); window.showRecipeModal(productId);
    };

    /* ---------- Modal & start ---------- */
    document.addEventListener('input', e => {
        const el = e.target;
        if (el.classList && el.classList.contains('rp-input')) { const d = el.value.replace(/\D/g, ''); el.value = d ? Number(d).toLocaleString('id-ID') : ''; }
    });
    window.toggleFieldPassword = function (id, btn) {
        const input = document.getElementById(id), show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        const icon = btn.querySelector('i'); icon.classList.toggle('fa-eye', !show); icon.classList.toggle('fa-eye-slash', show);
    };
    window.closeModal = function (id) { document.getElementById(id)?.classList.remove('active'); };
    document.addEventListener('click', e => { if (e.target.classList.contains('modal-overlay') && !e.target.classList.contains('no-dismiss')) e.target.classList.remove('active'); });

    /* ---------- Printer (USB / Bluetooth) dengan auto-reconnect ---------- */
    const PRINTER_STORAGE_KEY = 'masuspace-printer';

    // Filter Web USB umum untuk printer thermal (class 7) + VID populer
    const USB_FILTERS = [
        { classCode: 7 }, // USB Printer class
        { vendorId: 0x04b8 }, // Epson
        { vendorId: 0x0519 }, // Star Micronics
        { vendorId: 0x0fe6 }, // ICS Advent
        { vendorId: 0x154f }, // SNBC
        { vendorId: 0x0dd4 }, // Custom
        { vendorId: 0x20d1 }, // Rongta
        { vendorId: 0x1fc9 }, // NXP
        { vendorId: 0x0416 }, // Winbond
        { vendorId: 0x1504 }, // Bixolon
        { vendorId: 0x0a1b }, // Seiko
        { vendorId: 0x0d28 }  // Makino
    ];

    function savePrinterState() {
        if (!state.printer.type) { localStorage.removeItem(PRINTER_STORAGE_KEY); return; }
        const p = { type: state.printer.type, name: state.printer.name };
        if (state.printer.type === 'usb') { p.vendorId = state.printer.vendorId; p.productId = state.printer.productId; }
        if (state.printer.type === 'bluetooth') { p.id = state.printer.id; }
        try { localStorage.setItem(PRINTER_STORAGE_KEY, JSON.stringify(p)); } catch (e) { console.error(e); }
    }

    // ESC/POS bytes untuk tes print
    function escposTest() {
        const enc = new TextEncoder();
        return enc.encode(
            '\x1B\x40' +                                  // INIT
            '\x1B\x21\x30' +                              // Double width & height
            'MASUSPACE POS\n' +
            '\x1B\x21\x00' +                              // Normal
            '================\n' +
            'Test Print Berhasil!\n' +
            'Printer: ' + (state.printer.name || '-') + '\n' +
            'Tanggal: ' + new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + '\n' +
            '================\n' +
            '\x1B\x64\x03' +                              // Feed 3 lines
            '\x1D\x56\x00'                                // Full cut
        );
    }

    async function writeToUSBPrinter(device, data) {
        // Cari endpoint OUT bulk di interface 0
        const iface = device.configuration.interfaces[0];
        const ep = iface.alternates[0].endpoints.find(e => e.direction === 'out' && e.type === 'bulk');
        const endpointNumber = ep ? ep.endpointNumber : 1;
        await device.transferOut(endpointNumber, data);
    }

    async function writeToBluetoothPrinter(device, data) {
        if (!device.gatt?.connected) await device.gatt.connect();
        const services = await device.gatt.getPrimaryServices();
        // Cari characteristic yang writable (umumnya 0x2af6 'printer' atau 0xff02 untuk beberapa printer)
        let writable = null;
        for (const svc of services) {
            const chars = await svc.getCharacteristics();
            const c = chars.find(ch => ch.properties.write || ch.properties.writeWithoutResponse);
            if (c) { writable = c; break; }
        }
        if (!writable) throw new Error('Tidak ada karakteristik printer yang bisa ditulis');
        // Chunk 20 byte (MTU default BLE) supaya stabil
        const chunkSize = writable.properties.writeWithoutResponse && !writable.properties.write ? 180 : 20;
        for (let i = 0; i < data.byteLength; i += chunkSize) {
            const chunk = data.slice(i, i + chunkSize);
            if (writable.properties.writeWithoutResponse) {
                await writable.writeValueWithoutResponse(chunk);
            } else {
                await writable.writeValueWithResponse(chunk);
            }
        }
    }

    async function sendToPrinter(data) {
        if (!state.printer.device) throw new Error('Printer belum terhubung');
        if (state.printer.type === 'usb') return await writeToUSBPrinter(state.printer.device, data);
        if (state.printer.type === 'bluetooth') return await writeToBluetoothPrinter(state.printer.device, data);
        throw new Error('Tipe printer tidak dikenal');
    }

    // Reconnect GATT kalau Bluetooth printer terputus (misalnya idle/sleep)
    function attachBluetoothReconnectHandler(device) {
        device.addEventListener('gattserverdisconnected', async () => {
            console.log('Bluetooth printer disconnected, will retry in 2s...');
            // Jangan ubah state.printer.device supaya bisa dipakai lagi
            let attempts = 0;
            const tryReconnect = async () => {
                if (attempts > 10) { console.warn('Gagal reconnect BT setelah 10x.'); return; }
                attempts++;
                try {
                    await device.gatt.connect();
                    console.log('Bluetooth printer reconnected on attempt', attempts);
                    if (typeof showToast === 'function') showToast('Printer Bluetooth tersambung kembali');
                } catch (e) {
                    setTimeout(tryReconnect, 2000);
                }
            };
            setTimeout(tryReconnect, 2000);
        });
    }

    window.connectUSBPrinter = async function () {
        if (!navigator.usb) { showToast('Browser tidak mendukung Web USB. Gunakan Chrome/Edge via HTTPS.', true); return; }
        try {
            const device = await navigator.usb.requestDevice({ filters: USB_FILTERS });
            await device.open();
            if (device.configuration === null) await device.selectConfiguration(1);
            await device.claimInterface(0);
            state.printer = {
                type: 'usb', device,
                name: device.productName || `USB Printer ${device.vendorId.toString(16).padStart(4, '0')}:${device.productId.toString(16).padStart(4, '0')}`,
                vendorId: device.vendorId, productId: device.productId, id: null
            };
            savePrinterState();
            showToast('Printer USB terhubung: ' + state.printer.name);
            loadSettings();
        } catch (e) {
            if (e.name === 'NotFoundError') showToast('Tidak ada printer dipilih.', true);
            else showToast('Gagal menghubungkan USB: ' + (e.message || 'Unknown'), true);
            console.error(e);
        }
    };

    window.connectBluetoothPrinter = async function () {
        if (!navigator.bluetooth) { showToast('Browser tidak mendukung Web Bluetooth. Gunakan Chrome/Edge via HTTPS.', true); return; }
        try {
            // UUID thermal printer BLE yang umum (Rongta, Xprinter, Goojprt, Epson, Bixolon, dll)
            // Wajib pakai UUID full — nama alias 'printer' TIDAK valid di Web Bluetooth.
            const optionalServices = [
                '000018f0-0000-1000-8000-00805f9b34fb', // Printer service umum
                '000018f1-0000-1000-8000-00805f9b34fb', // Printer service varian
                '0000ff00-0000-1000-8000-00805f9b34fb', // Custom printer (umum di printer China)
                '0000ffe0-0000-1000-8000-00805f9b34fb', // SPP-over-BLE (TI cc254x)
                '0000ffe1-0000-1000-8000-00805f9b34fb', // SPP-over-BLE characteristic
                '49535343-fe7d-4ae5-8fa9-9fafd205e455', // TI UART service
                'e7810a71-73ae-499d-8c15-faa5a80f03de', // Nordic UART service (NUART)
                '00001800-0000-1000-8000-00805f9b34fb', // generic_access
                '0000180a-0000-1000-8000-00805f9b34fb', // device_information
                '0000180f-0000-1000-8000-00805f9b34fb'  // battery_service
            ];
            const device = await navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices
            });
            await device.gatt.connect();
            attachBluetoothReconnectHandler(device);
            state.printer = { type: 'bluetooth', device, name: device.name || 'Bluetooth Printer', vendorId: null, productId: null, id: device.id };
            savePrinterState();
            showToast('Printer Bluetooth terhubung: ' + state.printer.name);
            loadSettings();
        } catch (e) {
            if (e.name === 'NotFoundError') showToast('Tidak ada printer dipilih.', true);
            else showToast('Gagal menghubungkan Bluetooth: ' + (e.message || 'Unknown'), true);
            console.error(e);
        }
    };

    window.disconnectPrinter = async function () {
        try {
            if (state.printer.type === 'usb' && state.printer.device) {
                try { await state.printer.device.close(); } catch (e) { /* ignore */ }
            } else if (state.printer.type === 'bluetooth' && state.printer.device?.gatt?.connected) {
                state.printer.device.gatt.disconnect();
            }
        } catch (e) { console.error(e); }
        state.printer = { type: null, device: null, name: null, vendorId: null, productId: null, id: null };
        localStorage.removeItem(PRINTER_STORAGE_KEY);
        showToast('Printer diputus');
        loadSettings();
    };

    window.testPrint = async function () {
        if (!state.printer.device) { showToast('Printer belum terhubung.', true); return; }
        try {
            await sendToPrinter(escposTest());
            showToast('Tes print berhasil dikirim ke ' + state.printer.name);
        } catch (e) {
            console.error(e);
            showToast('Tes print gagal: ' + (e.message || 'Unknown'), true);
            // Kalau Bluetooth, coba reconnect otomatis
            if (state.printer.type === 'bluetooth' && state.printer.device) {
                try { await state.printer.device.gatt.connect(); } catch (ee) {}
            }
        }
    };

    // Auto-reconnect: panggil saat app start
    async function reconnectPrinter() {
        const saved = localStorage.getItem(PRINTER_STORAGE_KEY);
        if (!saved) return;
        let p;
        try { p = JSON.parse(saved); } catch (e) { return; }
        try {
            if (p.type === 'usb' && navigator.usb) {
                const devices = await navigator.usb.getDevices();
                const match = devices.find(d => d.vendorId === p.vendorId && d.productId === p.productId);
                if (match) {
                    await match.open();
                    if (match.configuration === null) await match.selectConfiguration(1);
                    await match.claimInterface(0);
                    state.printer = { type: 'usb', device: match, name: p.name, vendorId: p.vendorId, productId: p.productId, id: null };
                    console.log('Printer USB auto-reconnect:', p.name);
                }
            } else if (p.type === 'bluetooth' && navigator.bluetooth) {
                // navigator.bluetooth.getDevices() (Chrome 95+)
                if (navigator.bluetooth.getDevices) {
                    const devices = await navigator.bluetooth.getDevices();
                    const match = devices.find(d => d.id === p.id || d.name === p.name);
                    if (match) {
                        attachBluetoothReconnectHandler(match);
                        await match.gatt.connect();
                        state.printer = { type: 'bluetooth', device: match, name: p.name, vendorId: null, productId: null, id: p.id || match.id };
                        console.log('Printer Bluetooth auto-reconnect:', p.name);
                    }
                } else {
                    // Fallback: state.printer dipakai tapi device handle null; user klik Tes Print akan meminta re-grant
                    console.warn('Browser tidak mendukung navigator.bluetooth.getDevices() — user perlu klik Hubungkan Bluetooth sekali lagi.');
                    state.printer = { type: 'bluetooth', device: null, name: p.name, vendorId: null, productId: null, id: p.id };
                }
            }
        } catch (e) {
            console.error('Printer auto-reconnect gagal:', e);
        }
    }

    // USB plug/unplug listener — auto-reconnect fisik
    if (navigator.usb) {
        navigator.usb.addEventListener('connect', e => {
            const saved = localStorage.getItem(PRINTER_STORAGE_KEY);
            if (!saved) return;
            try {
                const p = JSON.parse(saved);
                if (p.type === 'usb' && p.vendorId === e.device.vendorId && p.productId === e.device.productId) {
                    console.log('USB printer plugged back, reconnecting...');
                    reconnectPrinter().then(() => { if (state.currentPage === 'settings') loadSettings(); });
                }
            } catch (err) { /* ignore */ }
        });
        navigator.usb.addEventListener('disconnect', e => {
            if (state.printer.type === 'usb' && state.printer.device === e.device) {
                state.printer.device = null;
                console.warn('Printer USB fisik dicabut. Akan auto-reconnect saat dicolok lagi.');
                if (state.currentPage === 'settings') loadSettings();
                // Tetap simpan saved state (jangan hapus localStorage) supaya bisa reconnect
            }
        });
    }

    // Bluetooth availability listener — auto-reconnect saat adapter nyala
    if (navigator.bluetooth) {
        navigator.bluetooth.addEventListener('availabilitychanged', e => {
            if (e.value && localStorage.getItem(PRINTER_STORAGE_KEY)) {
                console.log('Bluetooth available again, reconnecting printer...');
                reconnectPrinter().then(() => { if (state.currentPage === 'settings') loadSettings(); });
            } else if (!e.value && state.printer.type === 'bluetooth') {
                console.warn('Bluetooth adapter off. Akan reconnect saat nyala lagi.');
                state.printer.device = null;
                if (state.currentPage === 'settings') loadSettings();
            }
        });
    }

    // Helper publik supaya receipt/order detail bisa langsung cetak ke printer thermal
    window.printToThermalPrinter = async function (text) {
        if (!state.printer.device) return false;
        try {
            const enc = new TextEncoder();
            await sendToPrinter(enc.encode('\x1B\x40' + text + '\n\x1B\x64\x03\x1D\x56\x00'));
            return true;
        } catch (e) {
            console.error('Print thermal gagal:', e);
            return false;
        }
    };
    window.isThermalPrinterConnected = function () { return !!state.printer.device; };
    window.getPrinterName = function () { return state.printer.name || null; };

    document.addEventListener('DOMContentLoaded', function () {
        applyBrandLogo(localStorage.getItem('masuspace-logo'));
        loadUsersToDropdown();
        if (!RECOVERY_LINK) window.restoreOwnerSession();
        // Auto-reconnect printer USB/Bluetooth yang sudah pernah disambung
        setTimeout(reconnectPrinter, 800);
        // Hapus isian password otomatis dari browser (autofill muncul sedikit terlambat)
        [150, 600].forEach(ms => setTimeout(() => { const pw = document.getElementById('loginPassword'); if (pw && document.activeElement !== pw) pw.value = ''; }, ms));
        bindDateFilter(['dashboardStartDate', 'dashboardEndDate'], loadDashboard);
        bindDateFilter(['orderFilterStart', 'orderFilterEnd'], loadOrders);
        bindDateFilter(['reportStartDate', 'reportEndDate'], window.loadSalesReport);
        bindDateFilter(['cashFilterStart', 'cashFilterEnd'], loadCash);
        bindDateFilter(['exportStartDate', 'exportEndDate'], window.loadExportData);
        document.getElementById('loginForm')?.addEventListener('submit', function (e) { e.preventDefault(); window.handleLogin(e); });
    });
})();
