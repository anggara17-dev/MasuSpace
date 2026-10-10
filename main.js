(function() {
    const SUPABASE_URL = 'https://lgyrypbzaspysibssttm.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxneXJ5cGJ6YXNweXNpYnNzdHRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2NDM4MzIsImV4cCI6MjEwNzIxOTgzMn0.lUPnYTvG8KjxQe2-e2FAhuDXbh6XA2g31Vc2_JWObN4';
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    let state = {
        categories: [], products: [], variants: [], addons: [], cart: [],
        selectedCategory: null, orderType: 'dine_in', taxRate: 10,
        modalProduct: null, modalVariant: { suhu: 'Hot', ukuran: 'Regular' },
        modalAddons: [], modalQty: 1
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
        } catch (e) {
            console.error(" Error:", e);
            document.getElementById('productsGrid').innerHTML = '<div class="loading">Error: ' + e.message + '</div>';
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

    window.closeModal = function() {
        document.getElementById('productModal').classList.remove('active');
        state.modalProduct = null;
    };

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
                    ${a ? `<p style="font-size:11px;color:var(--primary)">+ ${a}</p>` : ''}
                    ${item.notes ? `<p style="font-size:11px;color:var(--text-light)"> ${item.notes}</p>` : ''}
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
        const tax = sub * 0.1;
        const total = sub + tax;
        document.getElementById('subtotal').innerText = `Rp ${sub.toLocaleString('id-ID')}`;
        document.getElementById('tax').innerText = `Rp ${tax.toLocaleString('id-ID')}`;
        document.getElementById('total').innerText = `Rp ${total.toLocaleString('id-ID')}`;
        document.getElementById('btnTotal').innerText = `Rp ${total.toLocaleString('id-ID')}`;
        document.getElementById('placeOrderBtn').disabled = state.cart.length === 0;
    }

    window.setOrderType = function(type, btn) {
        state.orderType = type;
        document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    };

    window.processCheckout = async function() {
        if (state.cart.length === 0) return;
        const btn = document.getElementById('placeOrderBtn');
        const orig = btn.innerHTML;
        btn.innerHTML = '⏳ Processing...'; btn.disabled = true;
        const sub = state.cart.reduce((s, i) => s + i.unit_price * i.qty, 0);
        const tax = sub * 0.1;
        const total = sub + tax;
        try {
            const { data, error } = await supabase.rpc('checkout_order', {
                p_cashier_id: null,
                p_customer_name: document.getElementById('customerName').value || 'Walk-in',
                p_table_number: document.getElementById('tableNumber').value,
                p_order_type: state.orderType,
                p_items: state.cart.map(i => ({ product_id: i.product_id, variant_id: null, qty: i.qty, unit_price: i.unit_price, addons: i.addons, notes: i.notes })),
                p_discount_amount: 0, p_discount_percent: 0, p_tax_amount: tax,
                p_payment_method: 'cash', p_paid_amount: total, p_notes: ''
            });
            if (error) throw error;
            showToast(`✅ Order ${data.order_number} berhasil!`);
            state.cart = []; renderCart();
            document.getElementById('customerName').value = '';
            document.getElementById('tableNumber').value = '';
        } catch (e) {
            console.error(e);
            showToast(' ' + e.message, true);
        } finally {
            btn.innerHTML = orig; btn.disabled = state.cart.length === 0;
        }
    };

    function showToast(msg, err = false) {
        const t = document.getElementById('toast');
        t.innerText = msg;
        t.style.background = err ? '#ef4444' : 'var(--primary-dark)';
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 3000);
    }

    document.getElementById('searchInput').addEventListener('input', renderProducts);
    document.addEventListener('click', e => { if (e.target.id === 'productModal') window.closeModal(); });

    // START
    loadData();
})();
