// MasuSpace POS - app.js
// Clean version - No duplicates

const SUPABASE_URL = 'https://lgyrypbzaspysibssttm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxneXJ5cGJ6YXNweXNpYnNzdHRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2NDM4MzIsImV4cCI6MjEwNzIxOTgzMn0.lUPnYTvG8KjxQe2-e2FAhuDXbh6XA2g31Vc2_JWObN4';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let state = {
    categories: [],
    products: [],
    variants: [],
    addons: [],
    cart: [],
    selectedCategory: null,
    orderType: 'dine_in',
    taxRate: 10,
    modalProduct: null,
    modalVariant: { suhu: 'Hot', ukuran: 'Regular' },
    modalAddons: [],
    modalQty: 1,
    modalNotes: ''
};

document.addEventListener('DOMContentLoaded', async () => {
    console.log("App loaded, initializing...");
    updateDate();
    await loadData();
    renderCategories();
    renderProducts();
});

function updateDate() {
    const options = { weekday: 'long', day: 'numeric', month: 'long' };
    document.getElementById('currentDate').innerText = new Date().toLocaleDateString('id-ID', options);
}

async function loadData() {
    try {
        const { data: cats, error: e1 } = await supabase.from('categories').select('*').eq('is_active', true).order('display_order');
        if (e1) throw e1;
        state.categories = cats || [];

        const { data: prods, error: e2 } = await supabase.from('products').select('*').eq('is_active', true).order('display_order');
        if (e2) throw e2;
        state.products = prods || [];

        const { data: vars, error: e3 } = await supabase.from('product_variants').select('*').eq('is_active', true);
        if (e3) throw e3;
        state.variants = vars || [];

        const { data: adds, error: e4 } = await supabase.from('addons').select('*').eq('is_active', true).order('display_order');
        if (e4) throw e4;
        state.addons = adds || [];

        console.log("Data loaded:", { categories: state.categories.length, products: state.products.length });
    } catch (error) {
        console.error("Error loading data:", error);
        showToast("Gagal load data: " + error.message, true);
    }
}

function renderCategories() {
    const container = document.getElementById('categoriesContainer');
    let html = `<div class="category-card ${state.selectedCategory === null ? 'active' : ''}" onclick="selectCategory(null)"><h4>All Items</h4><span>${state.products.length} Items</span></div>`;
    
    state.categories.forEach(cat => {
        const count = state.products.filter(p => p.category_id === cat.id).length;
        html += `<div class="category-card ${state.selectedCategory === cat.id ? 'active' : ''}" onclick="selectCategory('${cat.id}')"><h4>${cat.name}</h4><span>${count} Items</span></div>`;
    });
    
    container.innerHTML = html;
}

function renderProducts() {
    const container = document.getElementById('productsGrid');
    let filtered = state.products;
    
    if (state.selectedCategory) {
        filtered = filtered.filter(p => p.category_id === state.selectedCategory);
    }
    
    const search = document.getElementById('searchInput').value.toLowerCase();
    if (search) {
        filtered = filtered.filter(p => p.name.toLowerCase().includes(search));
    }

    if (filtered.length === 0) {
        container.innerHTML = '<div class="loading">No products found</div>';
        return;
    }

    container.innerHTML = filtered.map(p => `
        <div class="product-card" onclick="openProductModal('${p.id}')">
            <div class="product-img">☕</div>
            <div class="product-name">${p.name}</div>
            <div class="product-price">Rp ${parseInt(p.base_price).toLocaleString('id-ID')}</div>
            <div class="add-btn"><i class="fas fa-plus"></i></div>
        </div>
    `).join('');
}

function selectCategory(id) {
    state.selectedCategory = id;
    renderCategories();
    renderProducts();
}

document.getElementById('searchInput').addEventListener('input', renderProducts);

function openProductModal(productId) {
    const product = state.products.find(p => p.id === productId);
    if (!product) return;

    state.modalProduct = product;
    state.modalVariant = { suhu: 'Hot', ukuran: 'Regular' };
    state.modalAddons = [];
    state.modalQty = 1;
    state.modalNotes = '';

    renderModalVariants();
    renderModalAddons();
    updateModalTotal();

    document.getElementById('modalProductName').innerText = product.name;
    document.getElementById('modalNotes').value = '';
    document.getElementById('productModal').classList.add('active');
}

function closeModal() {
    document.getElementById('productModal').classList.remove('active');
    state.modalProduct = null;
}

function renderModalVariants() {
    document.getElementById('suhuVariants').innerHTML = `
        <div class="variant-option ${state.modalVariant.suhu === 'Hot' ? 'selected' : ''}" onclick="selectVariant('suhu', 'Hot')">Hot</div>
        <div class="variant-option ${state.modalVariant.suhu === 'Iced' ? 'selected' : ''}" onclick="selectVariant('suhu', 'Iced')">Iced (+Rp 2.000)</div>
    `;
    
    document.getElementById('ukuranVariants').innerHTML = `
        <div class="variant-option ${state.modalVariant.ukuran === 'Regular' ? 'selected' : ''}" onclick="selectVariant('ukuran', 'Regular')">Regular</div>
        <div class="variant-option ${state.modalVariant.ukuran === 'Large' ? 'selected' : ''}" onclick="selectVariant('ukuran', 'Large')">Large (+Rp 3.000)</div>
    `;
}

function selectVariant(type, value) {
    state.modalVariant[type] = value;
    renderModalVariants();
    updateModalTotal();
}

function renderModalAddons() {
    document.getElementById('addonsList').innerHTML = state.addons.map(addon => `
        <div class="addon-item">
            <div class="addon-info">
                <input type="checkbox" class="addon-checkbox" ${state.modalAddons.includes(addon.id) ? 'checked' : ''} onchange="toggleAddon('${addon.id}', ${addon.price})">
                <span>${addon.name}</span>
            </div>
            <span class="addon-price">+Rp ${addon.price.toLocaleString('id-ID')}</span>
        </div>
    `).join('');
}

function toggleAddon(addonId, price) {
    if (state.modalAddons.includes(addonId)) {
        state.modalAddons = state.modalAddons.filter(id => id !== addonId);
    } else {
        state.modalAddons.push(addonId);
    }
    updateModalTotal();
}

function changeModalQty(delta) {
    state.modalQty = Math.max(1, state.modalQty + delta);
    document.getElementById('modalQty').innerText = state.modalQty;
    updateModalTotal();
}

function updateModalTotal() {
    if (!state.modalProduct) return;

    let price = parseFloat(state.modalProduct.base_price);
    if (state.modalVariant.suhu === 'Iced') price += 2000;
    if (state.modalVariant.ukuran === 'Large') price += 3000;

    state.modalAddons.forEach(addonId => {
        const addon = state.addons.find(a => a.id === addonId);
        if (addon) price += parseFloat(addon.price);
    });

    const total = price * state.modalQty;
    document.getElementById('modalTotal').innerText = `Rp ${total.toLocaleString('id-ID')}`;
}

function addToCartFromModal() {
    if (!state.modalProduct) return;

    let unitPrice = parseFloat(state.modalProduct.base_price);
    if (state.modalVariant.suhu === 'Iced') unitPrice += 2000;
    if (state.modalVariant.ukuran === 'Large') unitPrice += 3000;

    const selectedAddons = state.modalAddons.map(id => {
        const addon = state.addons.find(a => a.id === id);
        unitPrice += parseFloat(addon.price);
        return { id: addon.id, name: addon.name, price: addon.price };
    });

    const existingIndex = state.cart.findIndex(item => 
        item.product_id === state.modalProduct.id &&
        item.variant_suhu === state.modalVariant.suhu &&
        item.variant_ukuran === state.modalVariant.ukuran &&
        JSON.stringify(item.addons) === JSON.stringify(selectedAddons)
    );

    if (existingIndex >= 0) {
        state.cart[existingIndex].qty += state.modalQty;
    } else {
        state.cart.push({
            product_id: state.modalProduct.id,
            name: state.modalProduct.name,
            unit_price: unitPrice,
            qty: state.modalQty,
            variant_suhu: state.modalVariant.suhu,
            variant_ukuran: state.modalVariant.ukuran,
            addons: selectedAddons,
            notes: document.getElementById('modalNotes').value
        });
    }

    closeModal();
    renderCart();
    showToast(`${state.modalProduct.name} ditambahkan!`);
}

function updateQty(index, change) {
    state.cart[index].qty += change;
    if (state.cart[index].qty <= 0) {
        state.cart.splice(index, 1);
    }
    renderCart();
}

function removeFromCart(index) {
    state.cart.splice(index, 1);
    renderCart();
}

function renderCart() {
    const container = document.getElementById('orderList');
    
    if (state.cart.length === 0) {
        container.innerHTML = `<div class="empty-order"><i class="fas fa-shopping-basket"></i><p>No items yet</p></div>`;
        updateTotals(0);
        return;
    }

    container.innerHTML = state.cart.map((item, index) => {
        const variantText = `${item.variant_suhu} / ${item.variant_ukuran}`;
        const addonsText = item.addons.length > 0 ? item.addons.map(a => a.name).join(', ') : '';
        
        return `
        <div class="order-item">
            <div class="item-info">
                <h5>${item.name}</h5>
                <p>${variantText} • Rp ${item.unit_price.toLocaleString('id-ID')}</p>
                ${addonsText ? `<p style="font-size: 11px; color: var(--primary);">+ ${addonsText}</p>` : ''}
                ${item.notes ? `<p style="font-size: 11px; color: var(--text-light);">📝 ${item.notes}</p>` : ''}
                <div class="item-qty">
                    <button class="qty-btn" onclick="updateQty(${index}, -1)">-</button>
                    <span>${item.qty}</span>
                    <button class="qty-btn" onclick="updateQty(${index}, 1)">+</button>
                    <button class="qty-btn" onclick="removeFromCart(${index})" style="margin-left: 5px; color: #ef4444;">🗑</button>
                </div>
            </div>
            <div class="item-total">Rp ${(item.unit_price * item.qty).toLocaleString('id-ID')}</div>
        </div>`;
    }).join('');

    const subtotal = state.cart.reduce((sum, item) => sum + (item.unit_price * item.qty), 0);
    updateTotals(subtotal);
}

function updateTotals(subtotal) {
    const tax = subtotal * (state.taxRate / 100);
    const total = subtotal + tax;

    document.getElementById('subtotal').innerText = `Rp ${subtotal.toLocaleString('id-ID')}`;
    document.getElementById('tax').innerText = `Rp ${tax.toLocaleString('id-ID')}`;
    document.getElementById('total').innerText = `Rp ${total.toLocaleString('id-ID')}`;
    document.getElementById('btnTotal').innerText = `Rp ${total.toLocaleString('id-ID')}`;
    document.getElementById('placeOrderBtn').disabled = state.cart.length === 0;
}

function setOrderType(type, btn) {
    state.orderType = type;
    document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
}

async function processCheckout() {
    if (state.cart.length === 0) return;

    const btn = document.getElementById('placeOrderBtn');
    const originalContent = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
    btn.disabled = true;

    const subtotal = state.cart.reduce((sum, item) => sum + (item.unit_price * item.qty), 0);
    const tax = subtotal * (state.taxRate / 100);
    const total = subtotal + tax;

    try {
        const { data, error } = await supabase.rpc('checkout_order', {
            p_cashier_id: null,
            p_customer_name: document.getElementById('customerName').value || 'Walk-in',
            p_table_number: document.getElementById('tableNumber').value,
            p_order_type: state.orderType,
            p_items: state.cart.map(item => ({
                product_id: item.product_id,
                variant_id: null,
                qty: item.qty,
                unit_price: item.unit_price,
                addons: item.addons,
                notes: item.notes
            })),
            p_discount_amount: 0,
            p_discount_percent: 0,
            p_tax_amount: tax,
            p_payment_method: 'cash',
            p_paid_amount: total,
            p_notes: ''
        });

        if (error) throw error;

        showToast(`Order ${data.order_number} berhasil!`);
        state.cart = [];
        renderCart();
        document.getElementById('customerName').value = '';
        document.getElementById('tableNumber').value = '';
        
        const currentCount = parseInt(document.getElementById('totalOrders').innerText) || 0;
        document.getElementById('totalOrders').innerText = `${currentCount + 1} Orders`;

    } catch (error) {
        console.error(error);
        showToast('Error: ' + error.message, true);
    } finally {
        btn.innerHTML = originalContent;
        btn.disabled = state.cart.length === 0;
    }
}

function showToast(msg, isError = false) {
    const toast = document.getElementById('toast');
    toast.innerText = msg;
    toast.style.background = isError ? '#ef4444' : 'var(--primary-dark)';
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

document.addEventListener('click', (e) => {
    if (e.target.id === 'productModal') {
        closeModal();
    }
});
