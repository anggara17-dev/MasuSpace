// ==========================================
// 1. KONFIGURASI SUPABASE
// GANTI DENGAN KREDENSIAL PROJECT BARU KAMU!
// ==========================================
const SUPABASE_URL = 'https://lgyrypbzaspysibssttm.supabase.co'; 
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxneXJ5cGJ6YXNweXNpYnNzdHRtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MTY0MzgzMiwiZXhwIjoyMTA3MjE5ODMyfQ.hTo-_IRT3E3bCgFHcWQAqVlpgbKm2s4NHMS7on6KGE4'; 

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==========================================
// 2. STATE APLIKASI
// ==========================================
let state = {
    categories: [],
    products: [],
    cart: [],
    selectedCategory: null,
    orderType: 'dine_in',
    taxRate: 10
};

// ==========================================
// 3. INISIALISASI
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
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
        // Load Categories
        const { data: cats, error: catError } = await supabase
            .from('categories')
            .select('*')
            .eq('is_active', true)
            .order('display_order');
        
        if (catError) throw catError;
        state.categories = cats || [];

        // Load Products
        const { data: prods, error: prodError } = await supabase
            .from('products')
            .select('*')
            .eq('is_active', true)
            .order('display_order');
            
        if (prodError) throw prodError;
        state.products = prods || [];
        
    } catch (error) {
        console.error("Error loading data:", error);
        showToast("Gagal memuat data dari database!", true);
    }
}

// ==========================================
// 4. RENDER UI
// ==========================================
function renderCategories() {
    const container = document.getElementById('categoriesContainer');
    
    // Tambahkan tombol "All" di awal
    let html = `
        <div class="category-card ${state.selectedCategory === null ? 'active' : ''}" 
             onclick="selectCategory(null)">
            <h4>All Items</h4>
            <span>${state.products.length} Items</span>
        </div>
    `;

    html += state.categories.map(cat => `
        <div class="category-card ${state.selectedCategory === cat.id ? 'active' : ''}" 
             onclick="selectCategory('${cat.id}')">
            <h4>${cat.name}</h4>
            <span>${state.products.filter(p => p.category_id === cat.id).length} Items</span>
        </div>
    `).join('');
    
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
        <div class="product-card" onclick="addToCart('${p.id}')">
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

// ==========================================
// 5. LOGIKA KERANJANG (CART)
// ==========================================
function addToCart(productId) {
    const product = state.products.find(p => p.id === productId);
    if (!product) return;

    const existingItem = state.cart.find(item => item.product_id === productId);
    
    if (existingItem) {
        existingItem.qty += 1;
    } else {
        state.cart.push({
            product_id: product.id,
            name: product.name,
            price: parseFloat(product.base_price),
            qty: 1
        });
    }
    
    renderCart();
    showToast(`${product.name} ditambahkan!`);
}

function updateQty(index, change) {
    state.cart[index].qty += change;
    if (state.cart[index].qty <= 0) {
        state.cart.splice(index, 1);
    }
    renderCart();
}

function renderCart() {
    const container = document.getElementById('orderList');
    
    if (state.cart.length === 0) {
        container.innerHTML = `<div class="empty-order"><i class="fas fa-shopping-basket"></i><p>No items yet</p></div>`;
        updateTotals(0);
        return;
    }

    container.innerHTML = state.cart.map((item, index) => `
        <div class="order-item">
            <div class="item-info">
                <h5>${item.name}</h5>
                <p>Rp ${item.price.toLocaleString('id-ID')}</p>
                <div class="item-qty">
                    <button class="qty-btn" onclick="updateQty(${index}, -1)"><i class="fas fa-minus"></i></button>
                    <span>${item.qty}</span>
                    <button class="qty-btn" onclick="updateQty(${index}, 1)"><i class="fas fa-plus"></i></button>
                </div>
            </div>
            <div class="item-total">Rp ${(item.price * item.qty).toLocaleString('id-ID')}</div>
        </div>
    `).join('');

    const subtotal = state.cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
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

// ==========================================
// 6. CHECKOUT (Kirim ke Supabase)
// ==========================================
async function processCheckout() {
    if (state.cart.length === 0) return;

    const btn = document.getElementById('placeOrderBtn');
    const originalBtnContent = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
    btn.disabled = true;

    const subtotal = state.cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const tax = subtotal * (state.taxRate / 100);
    const total = subtotal + tax;

    const itemsPayload = state.cart.map(item => ({
        product_id: item.product_id,
        variant_id: null, 
        qty: item.qty,
        unit_price: item.price,
        addons: [],
        notes: ''
    }));

    try {
        const { data, error } = await supabase.rpc('checkout_order', {
            p_cashier_id: null, 
            p_customer_name: document.getElementById('customerName').value || 'Walk-in',
            p_table_number: document.getElementById('tableNumber').value,
            p_order_type: state.orderType,
            p_items: itemsPayload,
            p_discount_amount: 0,
            p_discount_percent: 0,
            p_tax_amount: tax,
            p_payment_method: 'cash', 
            p_paid_amount: total,
            p_notes: ''
        });

        if (error) throw error;

        showToast(`Order ${data.order_number} Berhasil!`);
        
        // Reset Cart & Form
        state.cart = [];
        renderCart();
        document.getElementById('customerName').value = '';
        document.getElementById('tableNumber').value = '';
        
        // Update counter (simulasi)
        let currentCount = parseInt(document.getElementById('totalOrders').innerText);
        document.getElementById('totalOrders').innerText = `${currentCount + 1} Orders`;

    } catch (error) {
        console.error(error);
        showToast('Error: ' + error.message, true);
    } finally {
        btn.innerHTML = originalBtnContent;
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
