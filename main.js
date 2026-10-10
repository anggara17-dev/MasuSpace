(function() {
    const SUPABASE_URL = 'https://lgyrypbzaspysibssttm.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxneXJ5cGJ6YXNweXNpYnNzdHRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2NDM4MzIsImV4cCI6MjEwNzIxOTgzMn0.lUPnYTvG8KjxQe2-e2FAhuDXbh6XA2g31Vc2_JWObN4';
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    let state = {
        categories: [], products: [], variants: [], addons: [], cart: [],
        selectedCategory: null, orderType: 'dine_in',
        modalProduct: null, modalVariant: { suhu: 'Hot', ukuran: 'Regular' },
        modalAddons: [], modalQty: 1,
        paymentMethod: 'cash', cashReceived: 0,
        holdOrders: [], currentReceipt: null
    };

    async function loadData() {
        try {
            const { data: cats } = await supabase.from('categories').select('*').eq('is_active', true);
            state.categories = cats || [];
            const { data: prods } = await supabase.from('products').select('*').eq('is_active', true);
            state.products = prods || [];
            const { data: vars } = await supabase.from('product_variants').select('*').eq('is_active', true);
            state.variants = vars || [];
            const { data: adds } = await supabase.from('addons').select('*').eq('is_active', true);
            state.addons = adds || [];
            console.log("✅ Data loaded:", state.categories.length, "categories,", state.products.length, "products");
            renderCategories();
            renderProducts();
            loadTodayStats();
        } catch (e) {
            console.error("❌ Error:", e);
            document.getElementById('productsGrid').innerHTML = '<div class="loading">Error: ' + e.message + '</div>';
        }
    }

    async function loadTodayStats() {
        try {
            const { data } = await supabase.rpc('get_daily_report');
            if (data) {
                document.getElementById('totalOrders').innerText = data.total_orders + ' Orders';
                document.getElementById('todayRevenue').innerText = 'Rp ' + parseInt(data.total_revenue).toLocaleString('id-ID');
            }
        } catch (e) {
            console.error("Error loading stats:", e);
        }
    }

    function renderCategories() {
        const c = document.getElementById('categoriesContainer');
        let h = `<div class="category-card ${!state.selectedCategory ? 'active' : ''}" onclick="window.selectCat(null)"><h4>All Items</h4><span>${state.products.length}</span></div>`;
        state.categories.forEach(cat => {
            const cnt = state.products.filter(p => p.category_id === cat.id).length;
            h += `<div class="category-card ${state.selectedCategory === cat.id ? 'active' : ''}" onclick="window.selectCat('${cat.id}')"><h4>${cat.name}</h4><span>${cnt}</span></div>`;
        });
        c.innerHTML = h;
    }

    function renderProducts() {
        const c = document.getElementById('productsGrid');
        let f = state.selectedCategory ? state.products.filter(p => p.category_id === state.selectedCategory) : state.products;
        const search = document.getElementById('searchInput').value.toLowerCase();
        if (search) f = f.filter(p => p.name.toLowerCase().includes(search));
        if (f.length === 0) { c.innerHTML = '<div class="loading">No products</div>'; return; }
        c.innerHTML = f.map(p => `
            <div class="product-card" onclick="window.openModal('${p.id}')">
                <div class="product-img">☕</div>
                <div class="product-name">${p.name}</div>
                <div class="product-price">Rp ${parseInt(p.base_price).toLocaleString('id-ID')}</div>
                <div class="add-btn"><i class="fas fa-plus"></i></div>
            </div>
        `).join('');
    }

    window.selectCat = function(id) { state.selectedCategory = id; renderCategories(); renderProducts(); };

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

    window.closeModal = function() { document.getElementById('productModal').classList.remove('active'); state.modalProduct = null; };

    function renderVariants() {
        document.getElementById('suhuVariants').innerHTML = `
            <div class="variant-option ${state.modalVariant.suhu === 'Hot' ? 'selected' : ''}" onclick="window.selVar('suhu','Hot')">Hot</div>
            <div class="variant-option ${state.modalVariant.suhu === 'Iced' ? 'selected' : ''}" onclick="window.selVar('suhu','Iced')">Iced (+Rp 2.000)</div>`;
        document.getElementById('ukuranVariants').innerHTML = `
            <div class="variant-option ${state.modalVariant.ukuran === 'Regular' ? 'selected' : ''}" onclick="window.selVar('ukuran','Regular')">Regular</div>
            <div class="variant-option ${state.modalVariant.ukuran === 'Large' ? 'selected' : ''}" onclick="window.selVar('ukuran','Large')">Large (+Rp 3.000)</div>`;
    }

    window.selVar = function(type, val) { state.modalVariant[type] = val; renderVariants(); updateModalTotal(); };

    function renderAddons() {
        document.getElementById('addonsList').innerHTML = state.addons.map(a => `
            <div class="addon-item">
                <div class="addon-info">
                    <input type="checkbox" class="addon-checkbox" ${state.modalAddons.includes(a.id) ? 'checked' : ''} onchange="window.togAddon('${a.id}', ${a.price})">
                    <span>${a.name}</span>
                </div>
                <span class="addon-price">+Rp ${a.price.toLocaleString('id-ID')}</span>
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
        document.getElementById('modalTotal').innerText = `Rp ${(price * state.modalQty).toLocaleString('id-ID')}`;
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
        const idx = state.cart.findIndex(i => i.product_id === state.modalProduct.id && i.variant_suhu === state.modalVariant.suhu && i.variant_ukuran === state.modalVariant.ukuran);
        if (idx >= 0) state.cart[idx].qty += state.modalQty;
        else state.cart.push({ product_id: state.modalProduct.id, name: state.modalProduct.name, unit_price: unitPrice, qty: state.modalQty, variant_suhu: state.modalVariant.suhu, variant_ukuran: state.modalVariant.ukuran, addons: selAddons, notes: notes });
        window.closeModal();
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
            c.innerHTML = `<div class="empty-order"><i class="fas fa-shopping-basket"></i><p>No items yet</p></div>`;
            updateTotals(0); return;
        }
        c.innerHTML = state.cart.map((item, idx) => {
            const v = `${item.variant_suhu} / ${item.variant_ukuran}`;
            const a = item.addons.length > 0 ? item.addons.map(x => x.name).join(', ') : '';
            return `<div class="order-item">
                <div class="item-info">
                    <h5>${item.name}</h5>
                    <p>${v} • Rp ${item.unit_price.toLocaleString('id-ID')}</p>
                    ${a ? `<p style="font-size:10px;color:var(--primary)">+ ${a}</p>` : ''}
                    ${item.notes ? `<p style="font-size:10px;color:var(--text-light)"> ${item.notes}</p>` : ''}
                    <div class="item-qty">
                        <button class="qty-btn" onclick="window.updateQty(${idx},-1)">-</button>
                        <span>${item.qty}</span>
                        <button class="qty-btn" onclick="window.updateQty(${idx},1)">+</button>
                        <button class="qty-btn" onclick="window.removeFromCart(${idx})" style="color:#ef4444">🗑</button>
                    </div>
                </div>
                <div class="item-total">Rp ${(item.unit_price * item.qty).toLocaleString('id-ID')}</div>
            </div>`;
        }).join('');
        updateTotals(state.cart.reduce((s, i) => s + i.unit_price * i.qty, 0));
    }

    function updateTotals(sub) {
        const total = sub;
        document.getElementById('subtotal').innerText = `Rp ${sub.toLocaleString('id-ID')}`;
        document.getElementById('total').innerText = `Rp ${total.toLocaleString('id-ID')}`;
        document.getElementById('btnTotal').innerText = `Rp ${total.toLocaleString('id-ID')}`;
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
        document.getElementById('paymentTotal').innerText = `Rp ${sub.toLocaleString('id-ID')}`;
        document.getElementById('cashReceived').value = '';
        document.getElementById('changeAmount').innerText = 'Rp 0';
        state.cashReceived = 0;
        document.getElementById('paymentModal').classList.add('active');
    };

    window.closePaymentModal = function() { document.getElementById('paymentModal').classList.remove('active'); };

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
        document.getElementById('changeAmount').innerText = `Rp ${change.toLocaleString('id-ID')}`;
    };

    window.processPayment = async function() {
        const sub = state.cart.reduce((s, i) => s + i.unit_price * i.qty, 0);
        if (state.paymentMethod === 'cash' && state.cashReceived < sub) {
            showToast('❌ Uang tidak cukup!', true);
            return;
        }
        const btn = document.querySelector('.confirm-payment-btn');
        const orig = btn.innerText;
        btn.innerText = ' Processing...'; btn.disabled = true;
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
            showToast(`✅ Order ${data.order_number} berhasil!`);
            state.currentReceipt = { ...data, items: [...state.cart], payment_method: state.paymentMethod, cash_received: state.cashReceived, change: state.cashReceived - sub };
            state.cart = []; renderCart();
            document.getElementById('customerName').value = '';
            document.getElementById('tableNumber').value = '';
            window.closePaymentModal();
            window.showReceipt();
            loadTodayStats();
        } catch (e) {
            console.error(e);
            showToast('❌ ' + e.message, true);
        } finally {
            btn.innerText = orig; btn.disabled = false;
        }
    };

    window.showReceipt = function() {
        if (!state.currentReceipt) return;
        const r = state.currentReceipt;
        const sub = r.items.reduce((s, i) => s + i.unit_price * i.qty, 0);
        let html = `
            <div class="receipt-header">
                <h3>MASUSPACE</h3>
                <p>Coffee Shop</p>
                <p style="font-size:10px;margin-top:8px">${new Date().toLocaleString('id-ID')}</p>
            </div>
            <div class="receipt-items">
                ${r.items.map(i => `
                    <div class="receipt-item">
                        <div>${i.name} x${i.qty}</div>
                        <div>Rp ${(i.unit_price * i.qty).toLocaleString('id-ID')}</div>
                    </div>
                `).join('')}
            </div>
            <div class="receipt-total">
                <div class="receipt-item"><span>Total</span><span>Rp ${sub.toLocaleString('id-ID')}</span></div>
                <div class="receipt-item"><span>Payment</span><span>${r.payment_method.toUpperCase()}</span></div>
                ${r.payment_method === 'cash' ? `
                    <div class="receipt-item"><span>Cash</span><span>Rp ${r.cash_received.toLocaleString('id-ID')}</span></div>
                    <div class="receipt-item"><span>Change</span><span>Rp ${r.change.toLocaleString('id-ID')}</span></div>
                ` : ''}
            </div>
            <div style="text-align:center;margin-top:12px;font-size:10px">
                <p>Terima kasih!</p>
                <p>Order: ${r.order_number}</p>
            </div>
        `;
        document.getElementById('receiptContent').innerHTML = html;
        document.getElementById('receiptModal').classList.add('active');
    };

    window.closeReceiptModal = function() { document.getElementById('receiptModal').classList.remove('active'); };

    window.printReceipt = function() {
        const content = document.getElementById('receiptContent').innerHTML;
        const printWindow = window.open('', '', 'width=400,height=600');
        printWindow.document.write(`
            <html><head><title>Receipt</title>
            <style>body{font-family:'Courier New',monospace;font-size:12px;padding:20px;} .receipt-item{display:flex;justify-content:space-between;margin-bottom:4px;} .receipt-header{text-align:center;margin-bottom:12px;border-bottom:1px dashed #000;padding-bottom:12px;} .receipt-total{border-top:1px dashed #000;padding-top:8px;font-weight:bold;}</style>
            </head><body>${content}</body></html>
        `);
        printWindow.document.close();
        printWindow.print();
    };

    window.showHoldOrders = async function() {
        try {
            const { data } = await supabase.from('orders').select('*').eq('status', 'held').order('created_at', { ascending: false });
            state.holdOrders = data || [];
            renderHoldOrders();
            document.getElementById('holdModal').classList.add('active');
        } catch (e) {
            console.error(e);
            showToast('❌ Error loading hold orders', true);
        }
    };

    function renderHoldOrders() {
        const c = document.getElementById('holdList');
        if (state.holdOrders.length === 0) {
            c.innerHTML = '<div class="empty-hold">No held orders</div>';
            return;
        }
        c.innerHTML = state.holdOrders.map(order => `
            <div class="hold-item" onclick="window.retrieveHoldOrder('${order.id}')">
                <div class="hold-item-header">
                    <span class="hold-item-number">${order.order_number}</span>
                    <span class="hold-item-time">${new Date(order.created_at).toLocaleTimeString('id-ID')}</span>
                </div>
                <div class="hold-item-total">Rp ${parseInt(order.total).toLocaleString('id-ID')}</div>
            </div>
        `).join('');
    }

    window.retrieveHoldOrder = async function(orderId) {
        try {
            const { data } = await supabase.from('order_items').select('*').eq('order_id', orderId);
            if (data && data.length > 0) {
                state.cart = data.map(item => ({
                    product_id: item.product_id,
                    name: state.products.find(p => p.id === item.product_id)?.name || 'Unknown',
                    unit_price: item.unit_price,
                    qty: item.qty,
                    variant_suhu: 'Hot',
                    variant_ukuran: 'Regular',
                    addons: item.addons || [],
                    notes: item.notes || ''
                }));
                renderCart();
                await supabase.rpc('retrieve_hold_order', { p_order_id: orderId });
                window.closeHoldModal();
                showToast('✅ Hold order retrieved!');
            }
        } catch (e) {
            console.error(e);
            showToast('❌ Error retrieving order', true);
        }
    };

    window.closeHoldModal = function() { document.getElementById('holdModal').classList.remove('active'); };

    window.showReport = async function() {
        document.getElementById('reportModal').classList.add('active');
        document.getElementById('reportContent').innerHTML = '<div class="loading">Loading report...</div>';
        try {
            const [reportData, topProducts, paymentBreakdown] = await Promise.all([
                supabase.rpc('get_daily_report'),
                supabase.rpc('get_top_products'),
                supabase.rpc('get_payment_breakdown')
            ]);
            const r = reportData.data || {};
            const tp = topProducts.data || [];
            const pb = paymentBreakdown.data || {};
            let html = `
                <div class="report-section">
                    <h3>📊 Today's Summary</h3>
                    <div class="report-stats">
                        <div class="stat-card"><div class="stat-label">Total Orders</div><div class="stat-value">${r.total_orders || 0}</div></div>
                        <div class="stat-card"><div class="stat-label">Total Revenue</div><div class="stat-value">Rp ${(r.total_revenue || 0).toLocaleString('id-ID')}</div></div>
                        <div class="stat-card"><div class="stat-label">Avg Order Value</div><div class="stat-value">Rp ${(r.avg_order_value || 0).toLocaleString('id-ID')}</div></div>
                        <div class="stat-card"><div class="stat-label">Total Items</div><div class="stat-value">${r.total_items || 0}</div></div>
                    </div>
                </div>
                <div class="report-section">
                    <h3>💳 Payment Methods</h3>
                    <div class="report-stats">
                        <div class="stat-card"><div class="stat-label">Cash</div><div class="stat-value">Rp ${(pb.cash || 0).toLocaleString('id-ID')}</div></div>
                        <div class="stat-card"><div class="stat-label">QRIS</div><div class="stat-value">Rp ${(pb.qris || 0).toLocaleString('id-ID')}</div></div>
                        <div class="stat-card"><div class="stat-label">Debit</div><div class="stat-value">Rp ${(pb.debit || 0).toLocaleString('id-ID')}</div></div>
                        <div class="stat-card"><div class="stat-label">Total</div><div class="stat-value">Rp ${(pb.total || 0).toLocaleString('id-ID')}</div></div>
                    </div>
                </div>
                <div class="report-section">
                    <h3>🏆 Top Products</h3>
                    <table class="report-table">
                        <thead><tr><th>Product</th><th>Qty</th><th>Revenue</th></tr></thead>
                        <tbody>
                            ${tp.map(p => `<tr><td>${p.name}</td><td>${p.total_qty}</td><td>Rp ${parseInt(p.total_revenue).toLocaleString('id-ID')}</td></tr>`).join('')}
                        </tbody>
                    </table>
                </div>
            `;
            document.getElementById('reportContent').innerHTML = html;
        } catch (e) {
            console.error(e);
            document.getElementById('reportContent').innerHTML = '<div class="loading">Error loading report</div>';
        }
    };

    window.closeReportModal = function() { document.getElementById('reportModal').classList.remove('active'); };

    function showToast(msg, err = false) {
        const t = document.getElementById('toast');
        t.innerText = msg;
        t.style.background = err ? '#ef4444' : 'var(--primary-dark)';
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 3000);
    }

    function updateDate() {
        const options = { weekday: 'long', day: 'numeric', month: 'long' };
        document.getElementById('currentDate').innerText = new Date().toLocaleDateString('id-ID', options);
    }

    document.getElementById('searchInput').addEventListener('input', renderProducts);
    document.addEventListener('click', e => {
        if (e.target.id === 'productModal') window.closeModal();
        if (e.target.id === 'paymentModal') window.closePaymentModal();
        if (e.target.id === 'holdModal') window.closeHoldModal();
        if (e.target.id === 'reportModal') window.closeReportModal();
        if (e.target.id === 'receiptModal') window.closeReceiptModal();
    });

    updateDate();
    loadData();
})();
