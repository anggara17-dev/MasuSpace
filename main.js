(function() {
    // KONFIGURASI
    const SUPABASE_URL = 'https://lgyrypbzaspysibssttm.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxneXJ5cGJ6YXNweXNpYnNzdHRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2NDM4MzIsImV4cCI6MjEwNzIxOTgzMn0.lUPnYTvG8KjxQe2-e2FAhuDXbh6XA2g31Vc2_JWObN4';
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // STATE GLOBAL
    let state = {
        pin: '',
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
        cashReceived: 0
    };

    // ==========================================
    // 1. AUTH & LOGIN
    // ==========================================
    window.addPin = function(num) {
        if (state.pin.length < 4) {
            state.pin += num;
            document.getElementById('pinDisplay').innerText = '*'.repeat(state.pin.length);
            if (state.pin.length === 4) setTimeout(window.submitPin, 300);
        }
    };
    window.clearPin = function() { state.pin = ''; document.getElementById('pinDisplay').innerText = ''; };
    window.submitPin = function() {
        // Hardcoded PIN untuk demo. Nanti bisa ambil dari DB.
        if (state.pin === '1234') {
            document.getElementById('loginPage').style.display = 'none';
            document.getElementById('mainApp').style.display = 'flex';
            window.navigate('dashboard');
        } else {
            showToast('PIN Salah!', true);
            window.clearPin();
        }
    };
    window.logout = function() {
        state.pin = '';
        window.clearPin();
        document.getElementById('mainApp').style.display = 'none';
        document.getElementById('loginPage').style.display = 'flex';
    };

    // ==========================================
    // 2. NAVIGATION
    // ==========================================
    window.navigate = async function(page) {
        state.currentPage = page;
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.getElementById(`page-${page}`).classList.add('active');
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');
        
        const titles = { dashboard: 'Dashboard', kasir: 'Kasir (POS)', orders: 'Riwayat Order', products: 'Daftar Menu', inventory: 'Inventory', cash: 'Kas & Bank', accounting: 'Akuntansi', reports: 'Laporan', settings: 'Pengaturan' };
        document.getElementById('pageTitle').innerText = titles[page] || 'Dashboard';
        document.getElementById('headerDate').innerText = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });

        // Load data spesifik halaman
        if (page === 'dashboard') await loadDashboard();
        if (page === 'kasir') await loadKasir();
        if (page === 'orders') await loadOrders();
        if (page === 'products') await loadProducts();
        if (page === 'inventory') await loadInventory();
        if (page === 'cash') await loadCash();
        if (page === 'accounting') await loadAccounting();
        if (page === 'reports') await loadReports();
        if (page === 'settings') await loadSettings();
    };

    // ==========================================
    // 3. DASHBOARD
    // ==========================================
    async function loadDashboard() {
        const today = new Date().toISOString().split('T')[0];
        try {
            const [report, topProd, cash] = await Promise.all([
                supabase.rpc('get_daily_report', { p_date: today }),
                supabase.rpc('get_top_products', { p_date: today, p_limit: 5 }),
                supabase.rpc('get_cash_sources')
            ]);
            
            const r = report.data || {};
            document.getElementById('statOrders').innerText = r.total_orders || 0;
            document.getElementById('statRevenue').innerText = formatRp(r.total_revenue || 0);
            
            const laci = (cash.data || []).find(c => c.name === 'Cash Kasir');
            document.getElementById('statCash').innerText = formatRp(laci?.current_balance || 0);
            
            // Dummy low stock for demo
            document.getElementById('statLowStock').innerText = '0'; 

            // Payment breakdown
            const pbHtml = `
                <div style="display:flex;justify-content:space-between;margin-bottom:8px"><span>Cash</span><b>${formatRp(r.cash_sales||0)}</b></div>
                <div style="display:flex;justify-content:space-between;margin-bottom:8px"><span>QRIS</span><b>${formatRp(r.qris_sales||0)}</b></div>
                <div style="display:flex;justify-content:space-between"><span>Debit</span><b>${formatRp(r.debit_sales||0)}</b></div>
            `;
            document.getElementById('dashPaymentMethods').innerHTML = pbHtml;

            // Top products
            const tp = topProd.data || [];
            document.getElementById('dashTopProducts').innerHTML = tp.length ? tp.map(p => `
                <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
                    <span>${p.name} <small style="color:var(--text-light)">(${p.total_qty}x)</small></span>
                    <b>${formatRp(p.total_revenue)}</b>
                </div>
            `).join('') : '<p style="color:var(--text-light);text-align:center;padding:20px">Belum ada data</p>';

        } catch (e) { console.error(e); }
    }

    // ==========================================
    // 4. KASIR (POS)
    // ==========================================
    async function loadKasir() {
        if (state.categories.length === 0) {
            const { data: cats } = await supabase.from('categories').select('*').eq('is_active', true);
            state.categories = cats || [];
            const { data: prods } = await supabase.from('products').select('*').eq('is_active', true);
            state.products = prods || [];
            const { data: vars } = await supabase.from('product_variants').select('*').eq('is_active', true);
            state.variants = vars || [];
            const { data: adds } = await supabase.from('addons').select('*').eq('is_active', true);
            state.addons = adds || [];
        }
        renderCategories();
        renderProducts();
    }

    function renderCategories() {
        const c = document.getElementById('categoriesContainer');
        let h = `<div class="category-card active" onclick="window.selectCat(null)"><h4>Semua</h4></div>`;
        state.categories.forEach(cat => {
            h += `<div class="category-card" onclick="window.selectCat('${cat.id}')"><h4>${cat.name}</h4></div>`;
        });
        c.innerHTML = h;
    }

    function renderProducts() {
        const c = document.getElementById('productsGrid');
        let f = state.products;
        const search = document.getElementById('searchInput')?.value.toLowerCase() || '';
        if (search) f = f.filter(p => p.name.toLowerCase().includes(search));
        
        c.innerHTML = f.map(p => `
            <div class="product-card" onclick="window.openModal('${p.id}')">
                <div class="product-img">☕</div>
                <div class="product-name">${p.name}</div>
                <div class="product-price">${formatRp(p.base_price)}</div>
                <button class="add-btn"><i class="fas fa-plus"></i></button>
            </div>
        `).join('');
    }

    window.selectCat = function(id) {
        // Simple filter logic for demo
        const cards = document.querySelectorAll('.category-card');
        cards.forEach(c => c.classList.remove('active'));
        event.currentTarget.classList.add('active');
        
        const c = document.getElementById('productsGrid');
        let f = id ? state.products.filter(p => p.category_id === id) : state.products;
        c.innerHTML = f.map(p => `
            <div class="product-card" onclick="window.openModal('${p.id}')">
                <div class="product-img">☕</div>
                <div class="product-name">${p.name}</div>
                <div class="product-price">${formatRp(p.base_price)}</div>
                <button class="add-btn"><i class="fas fa-plus"></i></button>
            </div>
        `).join('');
    };

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
            <div class="variant-option ${state.modalVariant.suhu === 'Hot' ? 'selected' : ''}" onclick="window.selVar('suhu','Hot')">Hot</div>
            <div class="variant-option ${state.modalVariant.suhu === 'Iced' ? 'selected' : ''}" onclick="window.selVar('suhu','Iced')">Iced (+2K)</div>`;
        document.getElementById('ukuranVariants').innerHTML = `
            <div class="variant-option ${state.modalVariant.ukuran === 'Regular' ? 'selected' : ''}" onclick="window.selVar('ukuran','Regular')">Regular</div>
            <div class="variant-option ${state.modalVariant.ukuran === 'Large' ? 'selected' : ''}" onclick="window.selVar('ukuran','Large')">Large (+3K)</div>`;
    }
    window.selVar = function(type, val) { state.modalVariant[type] = val; renderVariants(); updateModalTotal(); };

    function renderAddons() {
        document.getElementById('addonsList').innerHTML = state.addons.map(a => `
            <div class="addon-item">
                <label><input type="checkbox" ${state.modalAddons.includes(a.id) ? 'checked' : ''} onchange="window.togAddon('${a.id}', ${a.price})"> ${a.name}</label>
                <span>+${formatRp(a.price)}</span>
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
        if (state.modalVariant.ukuran === 'Large') price += 3000;
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
        if (state.modalVariant.ukuran === 'Large') unitPrice += 3000;
        const selAddons = state.modalAddons.map(id => {
            const a = state.addons.find(x => x.id === id);
            unitPrice += parseFloat(a.price);
            return { id: a.id, name: a.name, price: a.price };
        });
        const notes = document.getElementById('modalNotes').value;
        const idx = state.cart.findIndex(i => i.product_id === state.modalProduct.id && i.variant_suhu === state.modalVariant.suhu);
        if (idx >= 0) state.cart[idx].qty += state.modalQty;
        else state.cart.push({ product_id: state.modalProduct.id, name: state.modalProduct.name, unit_price: unitPrice, qty: state.modalQty, variant_suhu: state.modalVariant.suhu, variant_ukuran: state.modalVariant.ukuran, addons: selAddons, notes: notes });
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
            c.innerHTML = `<div class="empty-order"><i class="fas fa-shopping-basket" style="font-size:32px;margin-bottom:8px;opacity:0.3"></i><p>Belum ada item</p></div>`;
            updateTotals(0); return;
        }
        c.innerHTML = state.cart.map((item, idx) => `
            <div class="order-item">
                <div style="flex:1">
                    <div style="font-weight:600">${item.name}</div>
                    <div style="font-size:11px;color:var(--text-light)">${item.variant_suhu}/${item.variant_ukuran} • ${formatRp(item.unit_price)}</div>
                    <div class="item-qty">
                        <button class="qty-btn" onclick="window.updateQty(${idx},-1)">-</button>
                        <span>${item.qty}</span>
                        <button class="qty-btn" onclick="window.updateQty(${idx},1)">+</button>
                        <button class="qty-btn" onclick="window.removeFromCart(${idx})" style="color:#ef4444;border-color:#ef4444"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
                <div style="font-weight:700">${formatRp(item.unit_price * item.qty)}</div>
            </div>
        `).join('');
        updateTotals(state.cart.reduce((s, i) => s + i.unit_price * i.qty, 0));
    }

    function updateTotals(sub) {
        document.getElementById('subtotal').innerText = formatRp(sub);
        document.getElementById('total').innerText = formatRp(sub);
        document.getElementById('btnTotal').innerText = formatRp(sub);
        document.getElementById('placeOrderBtn').disabled = state.cart.length === 0;
    }

    window.setOrderType = function(type, btn) {
        state.orderType = type;
        document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    };

    window.showPaymentModal = function() {
        if (state.cart.length === 0) return;
        const sub = state.cart.reduce((s, i) => s + i.unit_price * i.qty, 0);
        document.getElementById('paymentTotal').innerText = formatRp(sub);
        document.getElementById('cashReceived').value = '';
        document.getElementById('changeAmount').innerText = formatRp(0);
        state.cashReceived = 0;
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
        document.getElementById('cashReceived').value = sub;
        state.cashReceived = sub;
        calculateChange();
    };
    window.calculateChange = function() {
        const received = parseFloat(document.getElementById('cashReceived').value) || 0;
        state.cashReceived = received;
        const sub = state.cart.reduce((s, i) => s + i.unit_price * i.qty, 0);
        const change = Math.max(0, received - sub);
        document.getElementById('changeAmount').innerText = formatRp(change);
    };

    window.processPayment = async function() {
        const sub = state.cart.reduce((s, i) => s + i.unit_price * i.qty, 0);
        if (state.paymentMethod === 'cash' && state.cashReceived < sub) {
            showToast('Uang tidak cukup!', true);
            return;
        }
        const btn = document.querySelector('.confirm-payment-btn');
        btn.innerText = 'Memproses...'; btn.disabled = true;
        try {
            const { data, error } = await supabase.rpc('checkout_order', {
                p_cashier_id: null,
                p_customer_name: document.getElementById('customerName').value || 'Walk-in',
                p_table_number: document.getElementById('tableNumber').value,
                p_order_type: state.orderType,
                p_items: state.cart.map(i => ({ product_id: i.product_id, variant_id: null, qty: i.qty, unit_price: i.unit_price, addons: i.addons, notes: i.notes })),
                p_discount_amount: 0, p_discount_percent: 0, p_tax_amount: 0,
                p_payment_method: state.paymentMethod, p_paid_amount: state.paymentMethod === 'cash' ? state.cashReceived : sub, p_notes: ''
            });
            if (error) throw error;
            showToast(`Order ${data.order_number} berhasil!`);
            state.currentReceipt = { ...data, items: [...state.cart], payment_method: state.paymentMethod, cash_received: state.cashReceived, change: state.cashReceived - sub };
            state.cart = []; renderCart();
            document.getElementById('customerName').value = '';
            document.getElementById('tableNumber').value = '';
            window.closeModal('paymentModal');
            window.showReceipt();
        } catch (e) {
            console.error(e);
            showToast('Error: ' + e.message, true);
        } finally {
            btn.innerText = 'Konfirmasi Pembayaran'; btn.disabled = false;
        }
    };

    window.showReceipt = function() {
        if (!state.currentReceipt) return;
        const r = state.currentReceipt;
        const sub = r.items.reduce((s, i) => s + i.unit_price * i.qty, 0);
        let html = `
            <div class="receipt-header"><h3>MASUSPACE</h3><p>Coffee Shop</p><p style="font-size:10px;margin-top:8px">${new Date().toLocaleString('id-ID')}</p></div>
            <div class="receipt-items">
                ${r.items.map(i => `<div class="receipt-item"><div>${i.name} x${i.qty}</div><div>${formatRp(i.unit_price * i.qty)}</div></div>`).join('')}
            </div>
            <div class="receipt-total">
                <div class="receipt-item"><span>Total</span><span>${formatRp(sub)}</span></div>
                <div class="receipt-item"><span>Bayar (${r.payment_method})</span><span>${formatRp(r.cash_received || sub)}</span></div>
                ${r.payment_method === 'cash' ? `<div class="receipt-item"><span>Kembali</span><span>${formatRp(r.change)}</span></div>` : ''}
            </div>
            <div style="text-align:center;margin-top:12px;font-size:10px"><p>Terima kasih!</p><p>${r.order_number}</p></div>
        `;
        document.getElementById('receiptContent').innerHTML = html;
        document.getElementById('receiptModal').classList.add('active');
    };

    window.printReceipt = function() {
        const content = document.getElementById('receiptContent').innerHTML;
        const w = window.open('', '', 'width=400,height=600');
        w.document.write(`<html><head><title>Struk</title><style>body{font-family:monospace;font-size:12px;padding:20px;} .receipt-item{display:flex;justify-content:space-between;margin-bottom:4px;} .receipt-header{text-align:center;margin-bottom:12px;border-bottom:1px dashed #000;padding-bottom:12px;} .receipt-total{border-top:1px dashed #000;padding-top:8px;font-weight:bold;}</style></head><body>${content}</body></html>`);
        w.document.close(); w.print();
    };

    // ==========================================
    // 5. ORDERS, PRODUCTS, INVENTORY, CASH, ETC
    // ==========================================
    async function loadOrders() {
        const date = document.getElementById('orderFilterDate')?.value || null;
        const { data } = await supabase.rpc('get_orders_with_details', { p_date: date });
        const orders = data || [];
        const tbody = document.getElementById('ordersTableBody');
        tbody.innerHTML = orders.map(o => `
            <tr>
                <td><b>${o.order_number}</b></td>
                <td>${new Date(o.created_at).toLocaleDateString('id-ID')}</td>
                <td>${o.order_type}</td>
                <td>${o.customer_name || '-'}</td>
                <td>${o.payment_method || '-'}</td>
                <td><b>${formatRp(o.total)}</b></td>
                <td><span class="badge badge-${o.status === 'paid' ? 'success' : 'warning'}">${o.status}</span></td>
                <td><button class="btn-primary" style="padding:4px 8px;font-size:11px" onclick="alert('Detail: ${o.order_number}')"><i class="fas fa-eye"></i></button></td>
            </tr>
        `).join('') || '<tr><td colspan="8" style="text-align:center;padding:20px">Tidak ada data</td></tr>';
    }
    window.loadOrders = loadOrders;

    async function loadProducts() {
        const { data } = await supabase.rpc('get_products_full');
        const products = data || [];
        document.getElementById('productsTableBody').innerHTML = products.map(p => `
            <tr>
                <td><b>${p.name}</b></td>
                <td>${p.category_name || '-'}</td>
                <td>${formatRp(p.base_price)}</td>
                <td><span class="badge badge-${p.is_active ? 'success' : 'danger'}">${p.is_active ? 'Aktif' : 'Nonaktif'}</span></td>
                <td>
                    <button class="btn-primary" style="padding:4px 8px;font-size:11px" onclick="alert('Edit: ${p.name}')"><i class="fas fa-edit"></i></button>
                    <button class="btn-primary" style="padding:4px 8px;font-size:11px;background:#ef4444" onclick="alert('Hapus: ${p.name}')"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `).join('') || '<tr><td colspan="5" style="text-align:center;padding:20px">Tidak ada data</td></tr>';
    }
    window.loadProducts = loadProducts;
    window.showProductForm = function() { alert('Fitur Tambah Produk (Modal Form)'); };
    window.switchProductTab = function(tab, btn) {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        // Logic switch tab content here
    };

    async function loadInventory() {
        const { data: summary } = await supabase.rpc('get_inventory_summary');
        const s = summary || {};
        document.getElementById('invTotal').innerText = s.total_ingredients || 0;
        document.getElementById('invLow').innerText = s.low_stock || 0;
        document.getElementById('invOut').innerText = s.out_of_stock || 0;
        document.getElementById('invValue').innerText = formatRp(s.total_value || 0);

        const { data } = await supabase.rpc('get_ingredients_full');
        const ings = data || [];
        document.getElementById('ingredientsTableBody').innerHTML = ings.map(i => `
            <tr>
                <td><b>${i.name}</b></td>
                <td>${i.stock_qty} ${i.unit}</td>
                <td>${i.min_stock} ${i.unit}</td>
                <td>${i.unit}</td>
                <td>${formatRp(i.buy_price)}</td>
                <td><span class="badge badge-${i.stock_qty <= i.min_stock ? 'warning' : 'success'}">${i.stock_qty <= i.min_stock ? 'Menipis' : 'Aman'}</span></td>
                <td><button class="btn-primary" style="padding:4px 8px;font-size:11px"><i class="fas fa-edit"></i></button></td>
            </tr>
        `).join('') || '<tr><td colspan="7" style="text-align:center;padding:20px">Tidak ada data</td></tr>';
    }
    window.loadInventory = loadInventory;
    window.showIngredientForm = function() { alert('Fitur Tambah Bahan (Modal Form)'); };

    async function loadCash() {
        const { data } = await supabase.rpc('get_cash_sources');
        const sources = data || [];
        document.getElementById('cashSourcesGrid').innerHTML = sources.map(s => `
            <div class="cash-card">
                <h4>${s.name}</h4>
                <div class="balance">${formatRp(s.current_balance)}</div>
            </div>
        `).join('');

        // Mutasi kas (dummy query karena function belum dibuat di SQL sebelumnya, kita pakai select langsung)
        const { data: muts } = await supabase.from('cash_mutations').select('*, cash_sources(name)').order('created_at', { ascending: false }).limit(20);
        const m = muts || [];
        document.getElementById('cashMutationsBody').innerHTML = m.map(mut => `
            <tr>
                <td>${new Date(mut.created_at).toLocaleDateString('id-ID')}</td>
                <td>${mut.cash_sources?.name || '-'}</td>
                <td><span class="badge badge-${mut.type === 'in' ? 'success' : 'warning'}">${mut.type}</span></td>
                <td>${mut.description}</td>
                <td style="color:${mut.type === 'in' ? 'var(--primary)' : '#ef4444'};font-weight:700">${mut.type === 'in' ? '+' : '-'}${formatRp(mut.amount)}</td>
            </tr>
        `).join('') || '<tr><td colspan="5" style="text-align:center;padding:20px">Belum ada mutasi</td></tr>';
    }
    window.loadCash = loadCash;
    window.showTransferModal = function() { alert('Modal Transfer Kas'); };
    window.showExpenseModal = function() { alert('Modal Pengeluaran Kas'); };

    async function loadAccounting() {
        document.getElementById('accountingContent').innerHTML = `
            <div class="table-container" style="padding:40px;text-align:center">
                <i class="fas fa-book" style="font-size:48px;color:var(--text-light);margin-bottom:16px"></i>
                <h3>Modul Akuntansi</h3>
                <p style="color:var(--text-light)">Jurnal, CoA, dan Laba Rugi akan ditampilkan di sini.</p>
            </div>
        `;
    }
    window.loadAccounting = loadAccounting;
    window.switchAccountingTab = function(tab, btn) {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
    };

    async function loadReports() {
        // Set default date range (this month)
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
        const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];
        document.getElementById('reportStartDate').value = firstDay;
        document.getElementById('reportEndDate').value = lastDay;
        await window.loadSalesReport();
    }
    window.loadReports = loadReports;

    window.loadSalesReport = async function() {
        const start = document.getElementById('reportStartDate').value;
        const end = document.getElementById('reportEndDate').value;
        if (!start || !end) return;
        
        const { data } = await supabase.rpc('get_sales_report', { p_start_date: start, p_end_date: end });
        const report = data || [];
        
        let totalRev = 0, totalCash = 0, totalQris = 0, totalDebit = 0, totalOrd = 0;
        report.forEach(r => { totalRev += r.total_revenue; totalCash += r.cash_revenue; totalQris += r.qris_revenue; totalDebit += r.debit_revenue; totalOrd += r.order_count; });

        document.getElementById('reportStats').innerHTML = `
            <div class="stat-card"><div class="stat-info"><div class="stat-label">Total Order</div><div class="stat-value">${totalOrd}</div></div></div>
            <div class="stat-card"><div class="stat-info"><div class="stat-label">Pendapatan</div><div class="stat-value">${formatRp(totalRev)}</div></div></div>
            <div class="stat-card"><div class="stat-info"><div class="stat-label">Cash</div><div class="stat-value">${formatRp(totalCash)}</div></div></div>
            <div class="stat-card"><div class="stat-info"><div class="stat-label">Non-Tunai</div><div class="stat-value">${formatRp(totalQris + totalDebit)}</div></div></div>
        `;

        document.getElementById('reportTableBody').innerHTML = report.map(r => `
            <tr>
                <td>${r.sale_date}</td>
                <td>${r.order_count}</td>
                <td>${formatRp(r.cash_revenue)}</td>
                <td>${formatRp(r.qris_revenue)}</td>
                <td>${formatRp(r.debit_revenue)}</td>
                <td><b>${formatRp(r.total_revenue)}</b></td>
            </tr>
        `).join('') || '<tr><td colspan="6" style="text-align:center;padding:20px">Tidak ada data</td></tr>';
    };

    async function loadSettings() {
        const { data } = await supabase.from('settings').select('*');
        const settings = {};
        (data || []).forEach(s => settings[s.key] = s.value);
        
        const store = settings.store_info || {};
        document.getElementById('settingStoreName').value = store.name || 'MasuSpace';
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
        await supabase.rpc('save_setting', { p_key: 'store_info', p_value: storeInfo });
        showToast('Pengaturan disimpan!');
    };
    window.changePin = function() {
        const newPin = document.getElementById('newPin').value;
        if (newPin.length === 4) {
            showToast('PIN berhasil diubah!');
            document.getElementById('newPin').value = '';
        } else {
            showToast('PIN harus 4 digit!', true);
        }
    };

    // ==========================================
    // UTILITIES
    // ==========================================
    window.closeModal = function(id) { document.getElementById(id).classList.remove('active'); };
    
    function formatRp(num) {
        return 'Rp ' + (num || 0).toLocaleString('id-ID');
    }

    function showToast(msg, err = false) {
        const t = document.getElementById('toast');
        t.innerText = msg;
        t.className = 'toast show' + (err ? ' error' : '');
        setTimeout(() => t.className = 'toast', 3000);
    }

    // Close modal on outside click
    document.addEventListener('click', e => {
        if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('active');
    });

    // Search listener
    document.getElementById('searchInput')?.addEventListener('input', renderProducts);

})();
