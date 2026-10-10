(function() {
    const SUPABASE_URL = 'https://lgyrypbzaspysibssttm.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxneXJ5cGJ6YXNweXNpYnNzdHRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2NDM4MzIsImV4cCI6MjEwNzIxOTgzMn0.lUPnYTvG8KjxQe2-e2FAhuDXbh6XA2g31Vc2_JWObN4';
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Prevent form default submit
    document.addEventListener('submit', function(e) { e.preventDefault(); return false; });

    // STATE
    let state = {
        currentUser: null,
        currentPage: 'dashboard',
        cart: [],
        categories: [],
        products: [],
        variants: [],
        addons: [],
        modalProduct: null,
        modalVariant: { suhu: 'Hot', ukuran: 'Regular' },
        modalAddons: [],
        modalQty: 1,
        paymentMethod: 'cash',
        cashReceived: 0,
        discount: { type: 'percent', value: 0 },
        orderType: 'dine_in',
        currentReceipt: null
    };

    // ========== UTILITIES ==========
    function formatRp(num) {
        return 'Rp ' + Math.round(num || 0).toLocaleString('id-ID');
    }

    function getJakartaDate() {
        return new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    }

    function getJakartaDateObj() {
        const now = new Date();
        const jakartaStr = now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
        return new Date(jakartaStr);
    }

    function getTodayJakarta() {
        const d = getJakartaDateObj();
        return d.toISOString().split('T')[0];
    }

    function showToast(msg, err = false) {
        const t = document.getElementById('toast');
        t.innerText = msg;
        t.className = 'toast show' + (err ? ' error' : '');
        setTimeout(() => t.className = 'toast', 3000);
    }

    // ========== LOGIN ==========
    async function loadUsersToDropdown() {
        try {
            const { data, error } = await supabase
                .from('app_users')
                .select('username, full_name, role')
                .eq('is_active', true)
                .order('full_name');
            
            if (error) { console.error('Error loading users:', error); return; }
            
            const select = document.getElementById('loginUsername');
            if (!select) return;
            
            select.innerHTML = '<option value="">— pilih user —</option>';
            
            (data || []).forEach(user => {
                const option = document.createElement('option');
                option.value = user.username;
                option.textContent = `${user.full_name} (${user.role})`;
                option.dataset.role = user.role;
                select.appendChild(option);
            });
            
        } catch (e) { console.error('Failed to load users:', e); }
    }

    window.togglePassword = function() {
        const input = document.getElementById('loginPassword');
        const icon = document.getElementById('passwordIcon');
        if (input.type === 'password') {
            input.type = 'text';
            icon.classList.remove('fa-eye');
            icon.classList.add('fa-eye-slash');
        } else {
            input.type = 'password';
            icon.classList.remove('fa-eye-slash');
            icon.classList.add('fa-eye');
        }
    };

    window.handleLogin = async function(e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        
        const username = document.getElementById('loginUsername').value.trim();
        const password = document.getElementById('loginPassword').value;

        if (!username || !password) {
            showToast('Lengkapi username dan password!', true);
            return false;
        }

        const btn = document.getElementById('loginBtn');
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Memproses...';
        btn.disabled = true;

        try {
            const { data, error } = await supabase
                .from('app_users')
                .select('*')
                .eq('username', username)
                .eq('password_hash', password)
                .eq('is_active', true)
                .single();

            if (error || !data) {
                showToast('Username atau password salah!', true);
                btn.innerHTML = originalText;
                btn.disabled = false;
                return false;
            }

            state.currentUser = data;
            
            document.getElementById('loginPage').style.display = 'none';
            document.getElementById('mainApp').style.display = 'flex';
            
            document.body.classList.toggle('role-kasir', data.role === 'kasir');
            
            document.getElementById('userName').innerText = data.full_name;
            document.getElementById('userName2').innerText = data.full_name;
            document.getElementById('userRole').innerText = data.role === 'owner' ? 'Administrator' : 'Kasir';
            document.getElementById('userRole2').innerText = data.role === 'owner' ? 'Administrator' : 'Kasir';
            document.getElementById('userAvatar').innerText = data.full_name.charAt(0).toUpperCase();
            document.getElementById('userAvatar2').innerText = data.full_name.charAt(0).toUpperCase();

            document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
                if (btn.classList.contains('owner-only') && data.role === 'kasir') {
                    btn.style.display = 'none';
                } else {
                    btn.style.display = 'flex';
                }
            });

            window.navigate('dashboard');
            
        } catch (err) {
            console.error('Login error:', err);
            showToast('Terjadi kesalahan: ' + err.message, true);
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
        
        return false;
    };

    window.logout = function() {
        state.currentUser = null;
        state.cart = [];
        document.getElementById('mainApp').style.display = 'none';
        document.getElementById('loginPage').style.display = 'flex';
        document.getElementById('loginPassword').value = '';
        document.body.classList.remove('role-kasir');
        window.closeUserMenu();
    };

    // ========== USER MENU ==========
    window.toggleUserMenu = function() {
        document.getElementById('userDropdown').classList.toggle('show');
    };

    window.closeUserMenu = function() {
        document.getElementById('userDropdown').classList.remove('show');
    };

    document.addEventListener('click', function(e) {
        const userMenu = document.querySelector('.user-menu');
        if (userMenu && !userMenu.contains(e.target)) {
            window.closeUserMenu();
        }
    });

    // ========== NAVIGATION ==========
    window.navigate = async function(page) {
        state.currentPage = page;
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const pageEl = document.getElementById(`page-${page}`);
        if (pageEl) pageEl.classList.add('active');

        document.querySelectorAll('.nav-item[data-page]').forEach(n => n.classList.remove('active'));
        const navBtn = document.querySelector(`.nav-item[data-page="${page}"]`);
        if (navBtn) navBtn.classList.add('active');

        const titles = {
            dashboard: 'Dashboard', kasir: 'Kasir POS', orders: 'Riwayat Order',
            products: 'Daftar Menu', inventory: 'Inventory', cash: 'Kas & Bank',
            expenses: 'Pengeluaran', accounting: 'Akuntansi', investors: 'Investor',
            reports: 'Laporan', settings: 'Pengaturan'
        };
        document.getElementById('pageTitle').innerText = titles[page] || 'Dashboard';

        if (page === 'dashboard') await loadDashboard();
        if (page === 'kasir') await loadKasirData();
        if (page === 'orders') await loadOrders();
        if (page === 'products') await loadProducts();
        if (page === 'inventory') await loadInventory();
        if (page === 'cash') await loadCash();
        if (page === 'accounting') await loadAccounting();
        if (page === 'investors') await loadInvestors();
        if (page === 'reports') await loadReports();
        if (page === 'settings') await loadSettings();

        if (window.innerWidth <= 1024) {
            document.getElementById('sidebar').classList.add('collapsed');
        }
        window.closeUserMenu();
    };

    window.toggleSidebar = function() {
        document.getElementById('sidebar').classList.toggle('collapsed');
    };

    // ========== LIVE CLOCK ==========
    function updateClock() {
        const now = getJakartaDateObj();
        const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta' });
        const dateStr = now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });
        const clockEl = document.getElementById('liveClock');
        if (clockEl) clockEl.innerText = timeStr + ' WIB';
        const dateEl = document.getElementById('headerDate');
        if (dateEl) dateEl.innerText = dateStr;
    }
    setInterval(updateClock, 1000);
    updateClock();

    // ========== DASHBOARD ==========
    async function loadDashboard() {
        const today = getTodayJakarta();
        try {
            const [report, topProd, cash, inv, expenses] = await Promise.all([
                supabase.rpc('get_daily_report', { p_date: today }),
                supabase.rpc('get_top_products', { p_date: today, p_limit: 5 }),
                supabase.rpc('get_cash_sources'),
                supabase.rpc('get_inventory_summary'),
                supabase.from('expenses').select('amount').gte('created_at', today + 'T00:00:00')
            ]);

            const r = report.data || {};
            const totalExpense = (expenses.data || []).reduce((s, e) => s + parseFloat(e.amount), 0);
            const netProfit = (r.total_revenue || 0) - totalExpense;

            document.getElementById('statOrders').innerText = r.total_orders || 0;
            document.getElementById('statRevenue').innerText = formatRp(r.total_revenue || 0);
            document.getElementById('statExpense').innerText = formatRp(totalExpense);
            document.getElementById('statProfit').innerText = formatRp(netProfit);
            document.getElementById('statProfit').style.color = netProfit >= 0 ? 'var(--primary-dark)' : '#ef4444';
            
            const laci = (cash.data || []).find(c => c.name === 'Cash Kasir');
            document.getElementById('statCash').innerText = formatRp(laci?.current_balance || 0);
            document.getElementById('statLowStock').innerText = (inv.data?.low_stock || 0) + (inv.data?.out_of_stock || 0);

            const pbHtml = `
                <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)"><span><i class="fas fa-money-bill-wave" style="color:#10b981;margin-right:8px"></i>Cash</span><b>${formatRp(r.cash_sales||0)}</b></div>
                <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)"><span><i class="fas fa-qrcode" style="color:#3b82f6;margin-right:8px"></i>QRIS</span><b>${formatRp(r.qris_sales||0)}</b></div>
                <div style="display:flex;justify-content:space-between;padding:10px 0"><span><i class="fas fa-credit-card" style="color:#f59e0b;margin-right:8px"></i>Debit</span><b>${formatRp(r.debit_sales||0)}</b></div>
            `;
            document.getElementById('dashPaymentMethods').innerHTML = pbHtml;

            const tp = topProd.data || [];
            document.getElementById('dashTopProducts').innerHTML = tp.length ? tp.map((p, i) => `
                <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);font-size:13px">
                    <span><span style="background:var(--primary);color:white;width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;margin-right:8px">${i+1}</span>${p.name} <small style="color:var(--text-light)">(${p.total_qty}x)</small></span>
                    <b>${formatRp(p.total_revenue)}</b>
                </div>
            `).join('') : '<p style="color:var(--text-light);text-align:center;padding:20px">Belum ada transaksi hari ini</p>';

        } catch (e) { console.error(e); }
    }

    // ========== KASIR ==========
    async function loadKasirData() {
        if (state.categories.length === 0) {
            const { data: cats } = await supabase.from('categories').select('*').eq('is_active', true).order('display_order');
            state.categories = cats || [];
            const { data: prods } = await supabase.from('products').select('*').eq('is_active', true).order('display_order');
            state.products = prods || [];
            const { data: vars } = await supabase.from('product_variants').select('*').eq('is_active', true);
            state.variants = vars || [];
            const { data: adds } = await supabase.from('addons').select('*').eq('is_active', true).order('display_order');
            state.addons = adds || [];
        }
        renderCategories();
        renderProducts();
        loadQuickExpenseSources();
    }

    async function loadQuickExpenseSources() {
        const { data } = await supabase.rpc('get_cash_sources');
        const sources = data || [];
        const select = document.getElementById('quickExpenseSource');
        if (select) {
            select.innerHTML = '<option value="">Sumber Kas</option>' + sources.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
        }
    }

    window.quickExpense = async function() {
        const source = document.getElementById('quickExpenseSource').value;
        const amount = parseFloat(document.getElementById('quickExpenseAmount').value) || 0;
        const category = document.getElementById('quickExpenseCategory').value;
        if (!source) { showToast('Pilih sumber kas!', true); return; }
        if (!amount) { showToast('Jumlah wajib!', true); return; }
        const { data, error } = await supabase.rpc('add_expense', { p_source_id: source, p_amount: amount, p_category: category, p_description: 'Pengeluaran kasir', p_created_by: state.currentUser?.id || null });
        if (error || !data?.success) { showToast('Gagal', true); return; }
        showToast('Pengeluaran dicatat!');
        document.getElementById('quickExpenseAmount').value = '';
    };

    function renderCategories() {
        const c = document.getElementById('categoriesContainer');
        let h = `<div class="category-card active" onclick="window.selectCat(null, this)"><h4>🍽️ Semua</h4></div>`;
        state.categories.forEach(cat => {
            h += `<div class="category-card" onclick="window.selectCat('${cat.id}', this)"><h4>${cat.icon || ''} ${cat.name}</h4></div>`;
        });
        c.innerHTML = h;
    }

    function renderProducts(filter = null) {
        const c = document.getElementById('productsGrid');
        let f = state.products;
        if (filter) f = f.filter(p => p.category_id === filter);
        const search = document.getElementById('searchInput')?.value.toLowerCase() || '';
        if (search) f = f.filter(p => p.name.toLowerCase().includes(search));

        if (f.length === 0) {
            c.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-light)">Tidak ada produk</div>';
            return;
        }
        c.innerHTML = f.map(p => `
            <div class="product-card" onclick="window.openModal('${p.id}')">
                <div class="product-img">☕</div>
                <div class="product-name">${p.name}</div>
                <div class="product-price">${formatRp(p.base_price)}</div>
                <button class="add-btn"><i class="fas fa-plus"></i></button>
            </div>
        `).join('');
    }

    window.selectCat = function(id, el) {
        document.querySelectorAll('.category-card').forEach(c => c.classList.remove('active'));
        if (el) el.classList.add('active');
        renderProducts(id);
    };

    document.getElementById('searchInput')?.addEventListener('input', () => renderProducts());

    window.openModal = function(pid) {
        const p = state.products.find(x => x.id === pid);
        if (!p) return;
        state.modalProduct = p;
        state.modalVariant = { suhu: 'Hot', ukuran: 'Regular' };
        state.modalAddons = [];
        state.modalQty = 1;
        document.getElementById('modalProductName').innerText = p.name;
        document.getElementById('modalNotes').value = '';
        document.getElementById('modalQty').innerText = '1';
        renderVariants();
        renderAddons();
        updateModalTotal();
        document.getElementById('productModal').classList.add('active');
    };

    function renderVariants() {
        document.getElementById('suhuVariants').innerHTML = `
            <div class="variant-option ${state.modalVariant.suhu === 'Hot' ? 'selected' : ''}" onclick="window.selVar('suhu','Hot')">☕ Hot</div>
            <div class="variant-option ${state.modalVariant.suhu === 'Iced' ? 'selected' : ''}" onclick="window.selVar('suhu','Iced')"> Iced (+2K)</div>`;
        document.getElementById('ukuranVariants').innerHTML = `
            <div class="variant-option ${state.modalVariant.ukuran === 'Regular' ? 'selected' : ''}" onclick="window.selVar('ukuran','Regular')">Regular</div>
            <div class="variant-option ${state.modalVariant.ukuran === 'Large' ? 'selected' : ''}" onclick="window.selVar('ukuran','Large')">Large (+5K)</div>`;
    }
    window.selVar = function(type, val) { state.modalVariant[type] = val; renderVariants(); updateModalTotal(); };

    function renderAddons() {
        document.getElementById('addonsList').innerHTML = state.addons.map(a => `
            <div class="addon-item">
                <label><input type="checkbox" ${state.modalAddons.includes(a.id) ? 'checked' : ''} onchange="window.togAddon('${a.id}', ${a.price})"> ${a.name}</label>
                <span style="font-weight:700;color:var(--primary-dark)">+${formatRp(a.price)}</span>
            </div>
        `).join('');
    }
    window.togAddon = function(id, price) {
        if (state.modalAddons.includes(id)) state.modalAddons = state.modalAddons.filter(x => x !== id);
        else state.modalAddons.push(id);
        updateModalTotal();
    };

    window.changeQty = function(d) {
        state.modalQty = Math.max(1, state.modalQty + d);
        document.getElementById('modalQty').innerText = state.modalQty;
        updateModalTotal();
    };

    function updateModalTotal() {
        if (!state.modalProduct) return;
        let price = parseFloat(state.modalProduct.base_price);
        if (state.modalVariant.suhu === 'Iced') price += 2000;
        if (state.modalVariant.ukuran === 'Large') price += 5000;
        state.modalAddons.forEach(id => {
            const a = state.addons.find(x => x.id === id);
            if (a) price += parseFloat(a.price);
        });
        document.getElementById('modalTotal').innerText = formatRp(price * state.modalQty);
    }

    window.addToCart = function() {
        if (!state.modalProduct) return;
        let unitPrice = parseFloat(state.modalProduct.base_price);
        if (state.modalVariant.suhu === 'Iced') unitPrice += 2000;
        if (state.modalVariant.ukuran === 'Large') unitPrice += 5000;
        const selAddons = state.modalAddons.map(id => {
            const a = state.addons.find(x => x.id === id);
            unitPrice += parseFloat(a.price);
            return { id: a.id, name: a.name, price: a.price };
        });
        const notes = document.getElementById('modalNotes').value;
        const key = `${state.modalProduct.id}-${state.modalVariant.suhu}-${state.modalVariant.ukuran}-${JSON.stringify(selAddons)}`;
        const idx = state.cart.findIndex(i => i.key === key);
        if (idx >= 0) state.cart[idx].qty += state.modalQty;
        else state.cart.push({ key, product_id: state.modalProduct.id, name: state.modalProduct.name, unit_price: unitPrice, qty: state.modalQty, variant_suhu: state.modalVariant.suhu, variant_ukuran: state.modalVariant.ukuran, addons: selAddons, notes: notes });
        window.closeModal('productModal');
        renderCart();
        showToast(`${state.modalProduct.name} ditambahkan!`);
    };

    window.updateQty = function(idx, d) {
        state.cart[idx].qty += d;
        if (state.cart[idx].qty <= 0) state.cart.splice(idx, 1);
        renderCart();
    };
    window.removeFromCart = function(idx) { state.cart.splice(idx, 1); renderCart(); };

    function renderCart() {
        const c = document.getElementById('orderList');
        if (state.cart.length === 0) {
            c.innerHTML = `<div class="empty-order"><i class="fas fa-shopping-basket"></i><p>Belum ada item</p></div>`;
            updateTotals(0); return;
        }
        c.innerHTML = state.cart.map((item, idx) => `
            <div class="order-item">
                <div style="flex:1">
                    <div style="font-weight:700">${item.name}</div>
                    <div style="font-size:11px;color:var(--text-light)">${item.variant_suhu}/${item.variant_ukuran} • ${formatRp(item.unit_price)}</div>
                    ${item.addons.length ? `<div style="font-size:10px;color:var(--primary)">+ ${item.addons.map(a=>a.name).join(', ')}</div>` : ''}
                    ${item.notes ? `<div style="font-size:10px;color:var(--text-light)">📝 ${item.notes}</div>` : ''}
                    <div class="item-qty">
                        <button class="qty-btn" onclick="window.updateQty(${idx},-1)">-</button>
                        <span style="font-weight:700;min-width:20px;text-align:center">${item.qty}</span>
                        <button class="qty-btn" onclick="window.updateQty(${idx},1)">+</button>
                        <button class="qty-btn" onclick="window.removeFromCart(${idx})" style="color:#ef4444;border-color:#ef4444"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
                <div style="font-weight:800;font-size:14px">${formatRp(item.unit_price * item.qty)}</div>
            </div>
        `).join('');
        const sub = state.cart.reduce((s, i) => s + i.unit_price * i.qty, 0);
        updateTotals(sub);
    }

    function calcDiscount(sub) {
        if (state.discount.type === 'percent') return sub * (state.discount.value / 100);
        return state.discount.value;
    }

    function updateTotals(sub) {
        const disc = calcDiscount(sub);
        const total = sub - disc;
        document.getElementById('subtotal').innerText = formatRp(sub);
        document.getElementById('total').innerText = formatRp(total);
        document.getElementById('btnTotal').innerText = formatRp(total);
        document.getElementById('placeOrderBtn').disabled = state.cart.length === 0;

        if (disc > 0) {
            document.getElementById('discountRow').style.display = 'flex';
            document.getElementById('discountAmount').innerText = '- ' + formatRp(disc);
            document.getElementById('discountDisplay').innerText = `Diskon: ${state.discount.type === 'percent' ? state.discount.value + '%' : formatRp(state.discount.value)}`;
        } else {
            document.getElementById('discountRow').style.display = 'none';
            document.getElementById('discountDisplay').innerText = 'Tidak ada diskon';
        }
    }

    window.setOrderType = function(type, btn) {
        state.orderType = type;
        document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    };

    // ========== DISCOUNT ==========
    window.showDiscountModal = function() {
        if (state.cart.length === 0) { showToast('Keranjang kosong!', true); return; }
        const sub = state.cart.reduce((s, i) => s + i.unit_price * i.qty, 0);
        document.getElementById('discountValue').value = state.discount.value || '';
        document.getElementById('discSubtotal').innerText = formatRp(sub);
        window.previewDiscount();
        document.getElementById('discountModal').classList.add('active');
    };

    window.setDiscountType = function(type, btn) {
        state.discount.type = type;
        document.querySelectorAll('.disc-type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('discountLabel').innerText = type === 'percent' ? 'Diskon (%)' : 'Diskon (Rp)';
        window.previewDiscount();
    };

    window.previewDiscount = function() {
        const sub = state.cart.reduce((s, i) => s + i.unit_price * i.qty, 0);
        const val = parseFloat(document.getElementById('discountValue').value) || 0;
        state.discount.value = val;
        const disc = calcDiscount(sub);
        document.getElementById('discAmount').innerText = '- ' + formatRp(disc);
        document.getElementById('discTotal').innerText = formatRp(sub - disc);
    };

    window.applyDiscount = function() {
        window.closeModal('discountModal');
        const sub = state.cart.reduce((s, i) => s + i.unit_price * i.qty, 0);
        updateTotals(sub);
        showToast('Diskon diterapkan!');
    };

    window.removeDiscount = function() {
        state.discount = { type: 'percent', value: 0 };
        document.getElementById('discountValue').value = '';
        window.closeModal('discountModal');
        const sub = state.cart.reduce((s, i) => s + i.unit_price * i.qty, 0);
        updateTotals(sub);
        showToast('Diskon dihapus');
    };

    // ========== PAYMENT ==========
    window.showPaymentModal = function() {
        if (state.cart.length === 0) return;
        const sub = state.cart.reduce((s, i) => s + i.unit_price * i.qty, 0);
        const total = sub - calcDiscount(sub);
        document.getElementById('paymentTotal').innerText = formatRp(total);
        document.getElementById('cashReceived').value = '';
        document.getElementById('changeAmount').innerText = formatRp(0);
        state.cashReceived = 0;
        state.paymentMethod = 'cash';
        document.querySelectorAll('.method-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
        document.getElementById('cashInputSection').style.display = 'block';
        document.getElementById('paymentModal').classList.add('active');
    };

    window.selectPaymentMethod = function(method, btn) {
        state.paymentMethod = method;
        document.querySelectorAll('.method-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('cashInputSection').style.display = method === 'cash' ? 'block' : 'none';
    };

    window.setQuickCash = function(amount) {
        document.getElementById('cashReceived').value = amount;
        state.cashReceived = amount;
        calculateChange();
    };
    window.setExactCash = function() {
        const sub = state.cart.reduce((s, i) => s + i.unit_price * i.qty, 0);
        const total = sub - calcDiscount(sub);
        document.getElementById('cashReceived').value = total;
        state.cashReceived = total;
        calculateChange();
    };
    window.calculateChange = function() {
        const received = parseFloat(document.getElementById('cashReceived').value) || 0;
        state.cashReceived = received;
        const sub = state.cart.reduce((s, i) => s + i.unit_price * i.qty, 0);
        const total = sub - calcDiscount(sub);
        const change = Math.max(0, received - total);
        document.getElementById('changeAmount').innerText = formatRp(change);
    };

    window.processPayment = async function() {
        const sub = state.cart.reduce((s, i) => s + i.unit_price * i.qty, 0);
        const total = sub - calcDiscount(sub);
        if (state.paymentMethod === 'cash' && state.cashReceived < total) {
            showToast('Uang tidak cukup!', true);
            return;
        }
        const btn = document.querySelector('.confirm-payment-btn');
        btn.innerText = ' Memproses...'; btn.disabled = true;
        try {
            const discAmt = calcDiscount(sub);
            const { data, error } = await supabase.rpc('checkout_order', {
                p_cashier_id: state.currentUser?.id || null,
                p_customer_name: document.getElementById('customerName').value || 'Walk-in',
                p_table_number: document.getElementById('tableNumber').value,
                p_order_type: state.orderType,
                p_items: state.cart.map(i => ({ product_id: i.product_id, variant_id: null, qty: i.qty, unit_price: i.unit_price, addons: i.addons, notes: i.notes })),
                p_discount_amount: state.discount.type === 'fixed' ? discAmt : 0,
                p_discount_percent: state.discount.type === 'percent' ? state.discount.value : 0,
                p_tax_amount: 0,
                p_payment_method: state.paymentMethod,
                p_paid_amount: state.paymentMethod === 'cash' ? state.cashReceived : total,
                p_notes: ''
            });
            if (error) throw error;
            showToast(`✅ Order ${data.order_number} berhasil!`);
            state.currentReceipt = { ...data, items: [...state.cart], payment_method: state.paymentMethod, cash_received: state.paymentMethod === 'cash' ? state.cashReceived : total, change: state.paymentMethod === 'cash' ? state.cashReceived - total : 0, discount: discAmt };
            state.cart = [];
            state.discount = { type: 'percent', value: 0 };
            renderCart();
            document.getElementById('customerName').value = '';
            document.getElementById('tableNumber').value = '';
            window.closeModal('paymentModal');
            setTimeout(() => window.showReceipt(), 300);
        } catch (e) {
            console.error(e);
            showToast('❌ ' + (e.message || 'Gagal'), true);
        } finally {
            btn.innerText = 'Konfirmasi Pembayaran'; btn.disabled = false;
        }
    };

    window.showReceipt = function() {
        if (!state.currentReceipt) return;
        const r = state.currentReceipt;
        const sub = r.items.reduce((s, i) => s + i.unit_price * i.qty, 0);
        let html = `
            <div class="receipt-header">
                <h3>☕ MASUSPACE</h3>
                <p>Coffee Shop</p>
                <p style="font-size:10px;margin-top:8px">${getJakartaDate()}</p>
                <p style="font-size:10px">${r.order_number}</p>
            </div>
            <div style="margin-bottom:10px">
                ${r.items.map(i => `
                    <div class="receipt-item"><div>${i.name} x${i.qty}</div><div>${formatRp(i.unit_price * i.qty)}</div></div>
                    ${i.variant_suhu ? `<div style="font-size:10px;color:#666">  ${i.variant_suhu}/${i.variant_ukuran}</div>` : ''}
                `).join('')}
            </div>
            <div class="receipt-total">
                <div class="receipt-item"><span>Subtotal</span><span>${formatRp(sub)}</span></div>
                ${r.discount > 0 ? `<div class="receipt-item"><span>Diskon</span><span>-${formatRp(r.discount)}</span></div>` : ''}
                <div class="receipt-item" style="font-size:14px"><span>TOTAL</span><span>${formatRp(r.total)}</span></div>
                <div class="receipt-item"><span>Bayar (${r.payment_method.toUpperCase()})</span><span>${formatRp(r.cash_received)}</span></div>
                ${r.payment_method === 'cash' ? `<div class="receipt-item"><span>Kembali</span><span>${formatRp(r.change)}</span></div>` : ''}
            </div>
            <div style="text-align:center;margin-top:12px;font-size:10px">
                <p>━━━━━━━━━━━━━━━━━━━</p>
                <p>Terima kasih!</p>
                <p>Selamat menikmati ☕</p>
            </div>
        `;
        document.getElementById('receiptContent').innerHTML = html;
        document.getElementById('receiptModal').classList.add('active');
    };

    window.printReceipt = function() {
        const content = document.getElementById('receiptContent').innerHTML;
        const w = window.open('', '', 'width=400,height=600');
        w.document.write(`<html><head><title>Struk</title><style>body{font-family:'Courier New',monospace;font-size:12px;padding:20px;} .receipt-item{display:flex;justify-content:space-between;margin-bottom:4px;} .receipt-header{text-align:center;margin-bottom:12px;border-bottom:1px dashed #000;padding-bottom:12px;} .receipt-total{border-top:1px dashed #000;padding-top:8px;font-weight:bold;}</style></head><body>${content}</body></html>`);
        w.document.close(); w.print();
    };

    // ========== DAILY REPORT ==========
    window.showDailyReport = async function() {
        const today = getTodayJakarta();
        document.getElementById('dailyReportContent').innerHTML = '<div style="text-align:center;padding:20px">Memuat...</div>';
        document.getElementById('dailyReportModal').classList.add('active');
        try {
            const [report, topProd, expenses] = await Promise.all([
                supabase.rpc('get_daily_report', { p_date: today }),
                supabase.rpc('get_top_products', { p_date: today, p_limit: 5 }),
                supabase.from('expenses').select('amount').gte('created_at', today + 'T00:00:00')
            ]);
            const r = report.data || {};
            const tp = topProd.data || [];
            const totalExp = (expenses.data || []).reduce((s, e) => s + parseFloat(e.amount), 0);
            const netProfit = (r.total_revenue || 0) - totalExp;
            document.getElementById('dailyReportContent').innerHTML = `
                <div class="stats-grid" style="grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
                    <div class="stat-card"><div class="stat-info"><div class="stat-label">Total Order</div><div class="stat-value" style="font-size:18px">${r.total_orders||0}</div></div></div>
                    <div class="stat-card"><div class="stat-info"><div class="stat-label">Pendapatan</div><div class="stat-value" style="font-size:18px">${formatRp(r.total_revenue||0)}</div></div></div>
                    <div class="stat-card"><div class="stat-info"><div class="stat-label">Pengeluaran</div><div class="stat-value" style="font-size:16px;color:#ef4444">${formatRp(totalExp)}</div></div></div>
                    <div class="stat-card"><div class="stat-info"><div class="stat-label">Laba Bersih</div><div class="stat-value" style="font-size:16px;color:${netProfit>=0?'var(--primary)':'#ef4444'}">${formatRp(netProfit)}</div></div></div>
                </div>
                <h4 style="margin-bottom:10px">🏆 Top Produk</h4>
                ${tp.length ? tp.map((p,i) => `<div style="display:flex;justify-content:space-between;padding:8px;border-bottom:1px solid var(--border);font-size:13px"><span>${i+1}. ${p.name} (${p.total_qty}x)</span><b>${formatRp(p.total_revenue)}</b></div>`).join('') : '<p style="color:var(--text-light);text-align:center;padding:20px">Belum ada data</p>'}
            `;
        } catch (e) {
            document.getElementById('dailyReportContent').innerHTML = '<p style="color:#ef4444;text-align:center">Gagal memuat</p>';
        }
    };

    // ========== HOLD ORDERS ==========
    window.showHoldOrders = async function() {
        const { data } = await supabase.from('orders').select('*').eq('status', 'held').order('created_at', { ascending: false });
        const holds = data || [];
        const c = document.getElementById('holdList');
        if (holds.length === 0) {
            c.innerHTML = '<div class="empty-hold">Tidak ada hold order</div>';
        } else {
            c.innerHTML = holds.map(o => `
                <div class="hold-item">
                    <div class="hold-item-header">
                        <span class="hold-item-number">${o.order_number}</span>
                        <span class="hold-item-time">${new Date(o.created_at).toLocaleTimeString('id-ID')}</span>
                    </div>
                    <div style="font-size:12px;color:var(--text-light)">${o.customer_name || 'Walk-in'} • ${o.order_type}</div>
                    <div class="hold-item-total">${formatRp(o.total)}</div>
                </div>
            `).join('');
        }
        document.getElementById('holdModal').classList.add('active');
    };

    // ========== ORDERS ==========
    async function loadOrders() {
        const start = document.getElementById('orderFilterStart')?.value;
        const end = document.getElementById('orderFilterEnd')?.value;
        
        let query = supabase.from('orders').select('*, app_users(full_name)').order('created_at', { ascending: false }).limit(100);
        if (start) query = query.gte('created_at', start + 'T00:00:00');
        if (end) query = query.lte('created_at', end + 'T23:59:59');
        
        const { data } = await query;
        const orders = data || [];
        const tbody = document.getElementById('ordersTableBody');
        if (orders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-light)">Tidak ada data</td></tr>';
            document.getElementById('ordersSummary').innerHTML = '';
            return;
        }
        let totalRev = 0, totalCash = 0, totalNonCash = 0;
        tbody.innerHTML = orders.map(o => {
            totalRev += parseFloat(o.total);
            if (o.payment_method === 'cash') totalCash += parseFloat(o.total);
            else totalNonCash += parseFloat(o.total);
            return `<tr>
                <td><b>${o.order_number}</b></td>
                <td>${new Date(o.created_at).toLocaleDateString('id-ID')}</td>
                <td><span class="badge badge-info">${o.order_type}</span></td>
                <td>${o.customer_name || '-'}</td>
                <td>${o.app_users?.full_name || '-'}</td>
                <td><span class="badge badge-${o.payment_method==='cash'?'success':o.payment_method==='qris'?'info':'warning'}">${(o.payment_method||'-').toUpperCase()}</span></td>
                <td><b>${formatRp(o.total)}</b></td>
                <td><span class="badge badge-${o.status==='paid'?'success':'warning'}">${o.status}</span></td>
            </tr>`;
        }).join('');

        document.getElementById('ordersSummary').innerHTML = `
            <div class="stats-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
                <div class="stat-card"><div class="stat-info"><div class="stat-label">Total Order</div><div class="stat-value">${orders.length}</div></div></div>
                <div class="stat-card"><div class="stat-info"><div class="stat-label">Cash</div><div class="stat-value">${formatRp(totalCash)}</div></div></div>
                <div class="stat-card"><div class="stat-info"><div class="stat-label">Non-Tunai</div><div class="stat-value">${formatRp(totalNonCash)}</div></div></div>
            </div>
        `;
    }
    window.loadOrders = loadOrders;
    window.resetOrderFilter = function() {
        document.getElementById('orderFilterStart').value = '';
        document.getElementById('orderFilterEnd').value = '';
        loadOrders();
    };

    // ========== PRODUCTS ==========
    async function loadProducts() {
        const { data } = await supabase.rpc('get_products_full');
        const products = data || [];
        document.getElementById('productsTableBody').innerHTML = products.length ? products.map(p => `
            <tr>
                <td><b>${p.name}</b></td>
                <td>${p.category_name || '-'}</td>
                <td>${formatRp(p.base_price)}</td>
                <td><span class="badge badge-${p.is_active?'success':'danger'}">${p.is_active?'Aktif':'Nonaktif'}</span></td>
                <td>
                    <button class="btn-secondary" style="padding:6px 10px;font-size:11px" onclick="window.editProduct('${p.id}')"><i class="fas fa-edit"></i></button>
                    <button class="btn-secondary" style="padding:6px 10px;font-size:11px;color:#ef4444" onclick="window.deleteProduct('${p.id}')"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `).join('') : '<tr><td colspan="5" style="text-align:center;padding:30px">Tidak ada data</td></tr>';
    }
    window.loadProducts = loadProducts;

    window.showProductForm = function() {
        document.getElementById('productFormTitle').innerText = 'Tambah Produk';
        document.getElementById('editProductId').value = '';
        document.getElementById('editProductName').value = '';
        document.getElementById('editProductPrice').value = '';
        document.getElementById('editProductDesc').value = '';
        const catSelect = document.getElementById('editProductCategory');
        catSelect.innerHTML = '<option value="">Pilih Kategori</option>' + state.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        document.getElementById('productFormModal').classList.add('active');
    };

    window.editProduct = async function(id) {
        const { data } = await supabase.from('products').select('*').eq('id', id).single();
        if (!data) return;
        document.getElementById('productFormTitle').innerText = 'Edit Produk';
        document.getElementById('editProductId').value = data.id;
        document.getElementById('editProductName').value = data.name;
        document.getElementById('editProductPrice').value = data.base_price;
        document.getElementById('editProductDesc').value = data.description || '';
        const catSelect = document.getElementById('editProductCategory');
        catSelect.innerHTML = '<option value="">Pilih Kategori</option>' + state.categories.map(c => `<option value="${c.id}" ${c.id===data.category_id?'selected':''}>${c.name}</option>`).join('');
        document.getElementById('productFormModal').classList.add('active');
    };

    window.saveProduct = async function() {
        const id = document.getElementById('editProductId').value || null;
        const name = document.getElementById('editProductName').value.trim();
        const cat = document.getElementById('editProductCategory').value || null;
        const price = parseFloat(document.getElementById('editProductPrice').value) || 0;
        const desc = document.getElementById('editProductDesc').value;
        if (!name || !price) { showToast('Nama dan harga wajib!', true); return; }
        const { error } = await supabase.rpc('save_product', { p_name: name, p_cat: cat, p_price: price, p_desc: desc, p_active: true, p_id: id });
        if (error) { showToast('Gagal: ' + error.message, true); return; }
        showToast('Produk disimpan!');
        window.closeModal('productFormModal');
        state.products = [];
        await loadProducts();
    };

    window.deleteProduct = async function(id) {
        if (!confirm('Hapus produk ini?')) return;
        const { error } = await supabase.rpc('delete_product', { p_id: id });
        if (error) { showToast('Gagal: ' + error.message, true); return; }
        showToast('Produk dihapus');
        state.products = [];
        await loadProducts();
    };

    // ========== INVENTORY ==========
    async function loadInventory() {
        const { data: summary } = await supabase.rpc('get_inventory_summary');
        const s = summary || {};
        document.getElementById('invTotal').innerText = s.total_ingredients || 0;
        document.getElementById('invLow').innerText = s.low_stock || 0;
        document.getElementById('invOut').innerText = s.out_of_stock || 0;
        document.getElementById('invValue').innerText = formatRp(s.total_value || 0);

        const { data } = await supabase.rpc('get_ingredients_full');
        const ings = data || [];
        document.getElementById('ingredientsTableBody').innerHTML = ings.length ? ings.map(i => {
            const stockValue = i.stock_qty * i.buy_price;
            const status = i.stock_qty <= 0 ? 'Habis' : i.stock_qty <= i.min_stock ? 'Menipis' : 'Aman';
            const badge = i.stock_qty <= 0 ? 'danger' : i.stock_qty <= i.min_stock ? 'warning' : 'success';
            return `<tr>
                <td><b>${i.name}</b></td>
                <td>${i.stock_qty}</td>
                <td>${i.min_stock}</td>
                <td>${i.unit}</td>
                <td>${formatRp(i.buy_price)}</td>
                <td><b>${formatRp(stockValue)}</b></td>
                <td>${i.supplier || '-'}</td>
                <td><span class="badge badge-${badge}">${status}</span></td>
                <td class="owner-only"><button class="btn-secondary" style="padding:6px 10px;font-size:11px" onclick="window.editIngredient('${i.id}')"><i class="fas fa-edit"></i></button></td>
            </tr>`;
        }).join('') : '<tr><td colspan="9" style="text-align:center;padding:30px">Tidak ada data</td></tr>';
    }
    window.loadInventory = loadInventory;

    window.showIngredientForm = function() {
        document.getElementById('ingredientFormTitle').innerText = 'Tambah Bahan';
        document.getElementById('editIngredientId').value = '';
        document.getElementById('editIngredientName').value = '';
        document.getElementById('editIngredientStock').value = '';
        document.getElementById('editIngredientUnit').value = 'gram';
        document.getElementById('editIngredientMin').value = '';
        document.getElementById('editIngredientPrice').value = '';
        document.getElementById('editIngredientSupplier').value = '';
        document.getElementById('ingredientFormModal').classList.add('active');
    };

    window.editIngredient = async function(id) {
        const { data } = await supabase.from('ingredients').select('*').eq('id', id).single();
        if (!data) return;
        document.getElementById('ingredientFormTitle').innerText = 'Edit Bahan';
        document.getElementById('editIngredientId').value = data.id;
        document.getElementById('editIngredientName').value = data.name;
        document.getElementById('editIngredientStock').value = data.stock_qty;
        document.getElementById('editIngredientUnit').value = data.unit;
        document.getElementById('editIngredientMin').value = data.min_stock;
        document.getElementById('editIngredientPrice').value = data.buy_price;
        document.getElementById('editIngredientSupplier').value = data.supplier || '';
        document.getElementById('ingredientFormModal').classList.add('active');
    };

    window.saveIngredient = async function() {
        const id = document.getElementById('editIngredientId').value || null;
        const name = document.getElementById('editIngredientName').value.trim();
        const stock = parseFloat(document.getElementById('editIngredientStock').value) || 0;
        const unit = document.getElementById('editIngredientUnit').value || 'gram';
        const min = parseFloat(document.getElementById('editIngredientMin').value) || 0;
        const price = parseFloat(document.getElementById('editIngredientPrice').value) || 0;
        const supplier = document.getElementById('editIngredientSupplier').value;
        if (!name) { showToast('Nama wajib!', true); return; }
        const { error } = await supabase.rpc('save_ingredient', { p_name: name, p_stock: stock, p_unit: unit, p_min: min, p_price: price, p_supplier: supplier, p_id: id });
        if (error) { showToast('Gagal: ' + error.message, true); return; }
        showToast('Bahan disimpan!');
        window.closeModal('ingredientFormModal');
        await loadInventory();
    };

    // ========== CASH ==========
    async function loadCash() {
        const { data } = await supabase.rpc('get_cash_sources');
        const sources = data || [];
        document.getElementById('cashSourcesGrid').innerHTML = sources.map(s => `
            <div class="cash-card">
                <h4><i class="fas fa-vault" style="margin-right:8px;color:var(--primary)"></i>${s.name}</h4>
                <div class="balance">${formatRp(s.current_balance)}</div>
            </div>
        `).join('');

        // Mutasi kas dengan filter tanggal
        const start = document.getElementById('cashFilterStart')?.value;
        const end = document.getElementById('cashFilterEnd')?.value;
        let query = supabase.from('cash_mutations').select('*, cash_sources(name)').order('created_at', { ascending: false }).limit(50);
        if (start) query = query.gte('created_at', start + 'T00:00:00');
        if (end) query = query.lte('created_at', end + 'T23:59:59');
        const { data: muts } = await query;
        const m = muts || [];
        document.getElementById('cashMutationsBody').innerHTML = m.length ? m.map(mut => `
            <tr>
                <td>${new Date(mut.created_at).toLocaleString('id-ID')}</td>
                <td>${mut.cash_sources?.name || '-'}</td>
                <td><span class="badge badge-${mut.type==='in'?'success':'warning'}">${mut.type.toUpperCase()}</span></td>
                <td>${mut.description || '-'}</td>
                <td style="color:${mut.type==='in'?'var(--primary)':'#ef4444'};font-weight:700">${mut.type==='in'?'+':'-'}${formatRp(mut.amount)}</td>
            </tr>
        `).join('') : '<tr><td colspan="5" style="text-align:center;padding:30px">Belum ada mutasi</td></tr>';

        const fromSelect = document.getElementById('transferFrom');
        const toSelect = document.getElementById('transferTo');
        if (fromSelect) fromSelect.innerHTML = sources.map(s => `<option value="${s.id}">${s.name} (${formatRp(s.current_balance)})</option>`).join('');
        if (toSelect) toSelect.innerHTML = sources.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    }
    window.loadCash = loadCash;

    window.showTransferModal = function() {
        document.getElementById('transferAmount').value = '';
        document.getElementById('transferDesc').value = '';
        document.getElementById('transferModal').classList.add('active');
    };

    window.processTransfer = async function() {
        const from = document.getElementById('transferFrom').value;
        const to = document.getElementById('transferTo').value;
        const amount = parseFloat(document.getElementById('transferAmount').value) || 0;
        const desc = document.getElementById('transferDesc').value.trim();
        if (from === to) { showToast('Sumber & tujuan sama!', true); return; }
        if (!amount) { showToast('Jumlah wajib!', true); return; }
        const { data, error } = await supabase.rpc('transfer_cash', { p_from: from, p_to: to, p_amount: amount, p_desc: desc, p_by: state.currentUser?.id || null });
        if (error || !data?.success) { showToast(data?.message || 'Gagal', true); return; }
        showToast('Transfer berhasil!');
        window.closeModal('transferModal');
        await loadCash();
    };

    // ========== ACCOUNTING ==========
    async function loadAccounting() {
        document.getElementById('accountingContent').innerHTML = `
            <div style="text-align:center;padding:60px;color:var(--text-light)">
                <i class="fas fa-book-open" style="font-size:48px;margin-bottom:16px;color:var(--primary)"></i>
                <h3>Modul Akuntansi</h3>
                <p style="margin-top:8px">Jurnal, Chart of Accounts, dan Laba Rugi akan ditampilkan di sini.</p>
            </div>
        `;
    }
    window.loadAccounting = loadAccounting;
    window.switchAccountingTab = function(tab, btn) {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
    };

    // ========== INVESTORS ==========
    async function loadInvestors() {
        const { data } = await supabase.from('investors').select('*').order('created_at', { ascending: false });
        const investors = data || [];
        document.getElementById('investorsTableBody').innerHTML = investors.length ? investors.map(i => `
            <tr>
                <td><b>${i.name}</b></td>
                <td>${formatRp(i.capital)}</td>
                <td>${i.share_percent}%</td>
                <td><span class="badge badge-${i.is_active?'success':'danger'}">${i.is_active?'Aktif':'Nonaktif'}</span></td>
                <td><button class="btn-secondary" style="padding:6px 10px;font-size:11px" onclick="window.editInvestor('${i.id}')"><i class="fas fa-edit"></i></button></td>
            </tr>
        `).join('') : '<tr><td colspan="5" style="text-align:center;padding:30px">Belum ada investor</td></tr>';
    }
    window.loadInvestors = loadInvestors;

    window.showInvestorForm = function() {
        document.getElementById('investorFormTitle').innerText = 'Tambah Investor';
        document.getElementById('editInvestorId').value = '';
        document.getElementById('editInvestorName').value = '';
        document.getElementById('editInvestorCapital').value = '';
        document.getElementById('editInvestorShare').value = '';
        document.getElementById('investorFormModal').classList.add('active');
    };

    window.editInvestor = async function(id) {
        const { data } = await supabase.from('investors').select('*').eq('id', id).single();
        if (!data) return;
        document.getElementById('investorFormTitle').innerText = 'Edit Investor';
        document.getElementById('editInvestorId').value = data.id;
        document.getElementById('editInvestorName').value = data.name;
        document.getElementById('editInvestorCapital').value = data.capital;
        document.getElementById('editInvestorShare').value = data.share_percent;
        document.getElementById('investorFormModal').classList.add('active');
    };

    window.saveInvestor = async function() {
        const id = document.getElementById('editInvestorId').value || null;
        const name = document.getElementById('editInvestorName').value.trim();
        const capital = parseFloat(document.getElementById('editInvestorCapital').value) || 0;
        const share = parseFloat(document.getElementById('editInvestorShare').value) || 0;
        if (!name) { showToast('Nama wajib!', true); return; }
        const { error } = await supabase.rpc('save_investor', { p_name: name, p_capital: capital, p_share: share, p_id: id });
        if (error) { showToast('Gagal: ' + error.message, true); return; }
        showToast('Investor disimpan!');
        window.closeModal('investorFormModal');
        await loadInvestors();
    };

    window.calculateProfitSharing = async function() {
        const period = document.getElementById('psPeriod').value;
        let start = document.getElementById('psStart').value;
        let end = document.getElementById('psEnd').value;
        
        const today = getTodayJakarta();
        if (period === 'month') {
            start = new Date().toISOString().slice(0,7) + '-01';
            end = today;
            document.getElementById('psStart').value = start;
            document.getElementById('psEnd').value = end;
        } else if (period === 'quarter') {
            const now = new Date();
            const quarter = Math.floor(now.getMonth() / 3);
            const startMonth = quarter * 3;
            start = new Date(now.getFullYear(), startMonth, 1).toISOString().split('T')[0];
            end = today;
            document.getElementById('psStart').value = start;
            document.getElementById('psEnd').value = end;
        }
        
        if (!start || !end) { showToast('Pilih tanggal!', true); return; }
        const { data, error } = await supabase.rpc('calculate_profit_sharing', { p_start: start, p_end: end });
        if (error) { showToast('Gagal: ' + error.message, true); return; }
        document.getElementById('profitResult').innerHTML = `
            <h4>Hasil Perhitungan (${start} s/d ${end})</h4>
            <div class="profit-row"><span>Laba Bersih</span><b style="color:var(--primary)">${formatRp(data.net_profit)}</b></div>
            <div class="profit-row"><span>Investor (70%)</span><b>${formatRp(data.investor_share)}</b></div>
            <div class="profit-row total"><span>Pengelola (30%)</span><b>${formatRp(data.manager_share)}</b></div>
            <p style="margin-top:12px;font-size:12px;color:var(--text-light)">✅ Data tersimpan di tabel profit_sharing dengan status "pending"</p>
        `;
    };

    // ========== REPORTS ==========
    async function loadReports() {
        const today = getTodayJakarta();
        const firstDay = new Date().toISOString().slice(0,7) + '-01';
        document.getElementById('reportStartDate').value = firstDay;
        document.getElementById('reportEndDate').value = today;
        await window.loadSalesReport();
    }
    window.loadReports = loadReports;

    window.setReportPreset = function(preset) {
        const today = getTodayJakarta();
        let start = today;
        if (preset === 'today') start = today;
        else if (preset === 'week') start = new Date(Date.now() - 7*24*60*60*1000).toISOString().split('T')[0];
        else if (preset === 'month') start = new Date().toISOString().slice(0,7) + '-01';
        document.getElementById('reportStartDate').value = start;
        document.getElementById('reportEndDate').value = today;
        window.loadSalesReport();
    };

    window.loadSalesReport = async function() {
        const start = document.getElementById('reportStartDate').value;
        const end = document.getElementById('reportEndDate').value;
        if (!start || !end) return;
        const { data } = await supabase.rpc('get_sales_report', { p_start_date: start, p_end_date: end });
        const report = data || [];
        let totalRev = 0, totalCash = 0, totalQris = 0, totalDebit = 0, totalOrd = 0;
        report.forEach(r => { totalRev += parseFloat(r.total_revenue); totalCash += parseFloat(r.cash_revenue); totalQris += parseFloat(r.qris_revenue); totalDebit += parseFloat(r.debit_revenue); totalOrd += parseInt(r.order_count); });

        document.getElementById('reportStats').innerHTML = `
            <div class="stat-card"><div class="stat-info"><div class="stat-label">Total Order</div><div class="stat-value">${totalOrd}</div></div></div>
            <div class="stat-card"><div class="stat-info"><div class="stat-label">Pendapatan</div><div class="stat-value">${formatRp(totalRev)}</div></div></div>
            <div class="stat-card"><div class="stat-info"><div class="stat-label">Cash</div><div class="stat-value">${formatRp(totalCash)}</div></div></div>
            <div class="stat-card"><div class="stat-info"><div class="stat-label">Non-Tunai</div><div class="stat-value">${formatRp(totalQris + totalDebit)}</div></div></div>
        `;

        document.getElementById('reportTableBody').innerHTML = report.length ? report.map(r => `
            <tr>
                <td>${r.sale_date}</td>
                <td>${r.order_count}</td>
                <td>${formatRp(r.cash_revenue)}</td>
                <td>${formatRp(r.qris_revenue)}</td>
                <td>${formatRp(r.debit_revenue)}</td>
                <td><b>${formatRp(r.total_revenue)}</b></td>
            </tr>
        `).join('') : '<tr><td colspan="6" style="text-align:center;padding:30px">Tidak ada data</td></tr>';
    };

    // ========== SETTINGS ==========
    async function loadSettings() {
        const { data } = await supabase.from('settings').select('*');
        const settings = {};
        (data || []).forEach(s => settings[s.key] = s.value);
        const store = settings.store_info || {};
        document.getElementById('settingStoreName').value = store.name || 'MasuSpace Coffee';
        document.getElementById('settingAddress').value = store.address || '';
        document.getElementById('settingPhone').value = store.phone || '';
        document.getElementById('settingEmail').value = store.email || '';
        const tax = settings.tax || {};
        document.getElementById('settingTaxEnabled').value = tax.enabled ? 'true' : 'false';
        document.getElementById('settingTaxRate').value = tax.rate || 0;
    }
    window.loadSettings = loadSettings;

    window.saveSettings = async function() {
        const storeInfo = {
            name: document.getElementById('settingStoreName').value,
            address: document.getElementById('settingAddress').value,
            phone: document.getElementById('settingPhone').value,
            email: document.getElementById('settingEmail').value
        };
        const tax = {
            enabled: document.getElementById('settingTaxEnabled').value === 'true',
            rate: parseFloat(document.getElementById('settingTaxRate').value) || 0
        };
        await supabase.rpc('save_setting', { p_key: 'store_info', p_value: storeInfo });
        await supabase.rpc('save_setting', { p_key: 'tax', p_value: tax });
        showToast('Pengaturan disimpan!');
    };

    // ========== MODAL HELPERS ==========
    window.closeModal = function(id) { document.getElementById(id).classList.remove('active'); };

    document.addEventListener('click', e => {
        if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('active');
    });

    // ========== INIT ==========
    document.addEventListener('DOMContentLoaded', function() {
        loadUsersToDropdown();
        
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', function(e) {
                e.preventDefault();
                window.handleLogin(e);
            });
        }
    });

})();
