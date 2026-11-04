/* ============================================================
   SMASH · data.js
   Capa compartida de datos entre cliente.html y cocina.html.
   Usa SmashLS (boot.js: IndexedDB del navegador) como "base de datos".
   IMPORTANTE: prototipo funcional en el navegador, no un backend
   real. Contraseñas en texto plano: válido para probar el flujo
   completo, pero antes de usarlo con clientes reales conviene
   moverlo a un backend con autenticación segura.
   ============================================================ */

const SmashDB = (function () {
  const KEYS = {
    USERS: 'smash_users',
    STAFF: 'smash_staff',
    SESSION_CLIENTE: 'smash_session_cliente',
    SESSION_STAFF: 'smash_session_staff',
    ORDERS: 'smash_orders',
    ORDER_SEQ: 'smash_order_seq',
    PRODUCTS: 'smash_products',
    DELIVERY_FEE: 'smash_delivery_fee',
    GASTOS_DIA: 'smash_gastos_dia', // gastos fijos manuales por fecha (nómina, publicidad, servicios, otros)
  };

  function read(key, fallback) {
    try {
      const raw = SmashLS.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      SmashLS.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error('SmashDB: no se pudo guardar', key, e);
    }
  }

  /* ---------------- Semillas iniciales (solo si no existen) ---------------- */

  function seedStaff() {
    const staff = read(KEYS.STAFF, null);
    if (!staff) {
      write(KEYS.STAFF, [
        { usuario: 'cocina', password: 'smash2026', nombre: 'Equipo Cocina' },
      ]);
      return;
    }
    // Auto-reparación: versiones anteriores guardaban "username" en vez de "usuario".
    // Si detectamos ese formato viejo, lo migramos solos sin que el usuario haga nada.
    const necesitaMigrar = staff.some((u) => !u.usuario && u.username);
    if (necesitaMigrar) {
      const migrado = staff.map((u) => {
        if (!u.usuario && u.username) {
          const { username, ...resto } = u;
          return { usuario: username, ...resto };
        }
        return u;
      });
      write(KEYS.STAFF, migrado);
    }
  }

  function seedProducts() {
    if (!read(KEYS.PRODUCTS, null)) {
      write(KEYS.PRODUCTS, [
        { id: 'smash', name: 'Smash', desc: 'La clásica: doble smash, queso, salsa de la casa.', price: 18900, cost: 10060, img: 'images/producto-smash.jpg', categoria: 'hamburguesa', activo: true },
        { id: 'american', name: 'American Smash', desc: 'Con lechuga y tomate fresco, sin tocineta.', price: 20900, cost: 10160, img: 'images/producto-american-smash.jpg', categoria: 'hamburguesa', activo: true },
        { id: 'toci', name: 'Smash Toci', desc: 'Nuestra insignia: doble carne, doble queso, tocineta.', price: 21900, cost: 11550, img: 'images/producto-smash-toci.jpg', categoria: 'hamburguesa', activo: true },
        { id: 'combo', name: 'Combo (papas + gaseosa)', desc: 'Papas a la francesa + gaseosa 400ml.', price: 6900, cost: 3200, img: 'images/producto-combo.jpg', categoria: 'combo', activo: true },
        { id: 'carneAd', name: 'Carne adicional', desc: '', price: 6500, cost: 2800, img: '', categoria: 'adicional', activo: true },
        { id: 'papasAd', name: 'Papas adicionales', desc: '', price: 6000, cost: 1200, img: '', categoria: 'adicional', activo: true },
        { id: 'salsaAd', name: 'Salsa adicional', desc: '', price: 2500, cost: 500, img: '', categoria: 'adicional', activo: true },
        { id: 'tociAd', name: 'Tocineta adicional', desc: '', price: 3000, cost: 1200, img: '', categoria: 'adicional', activo: true },
      ]);
    }
  }

  function seedDeliveryFee() {
    if (read(KEYS.DELIVERY_FEE, null) === null) {
      write(KEYS.DELIVERY_FEE, 4000);
    }
  }

  seedStaff();
  seedProducts();
  seedDeliveryFee();

  /* ---------------- Clientes: registro / login ---------------- */

  function registerCliente({ nombre, usuario, telefono, password }) {
    const users = read(KEYS.USERS, []);
    if (users.some((u) => u.usuario.toLowerCase() === usuario.toLowerCase())) {
      return { ok: false, error: 'Ese usuario ya existe.' };
    }
    users.push({ nombre, usuario, telefono, password });
    write(KEYS.USERS, users);
    return { ok: true };
  }

  function loginCliente(usuario, password) {
    const users = read(KEYS.USERS, []);
    const found = users.find(
      (u) => u.usuario.toLowerCase() === usuario.toLowerCase() && u.password === password
    );
    if (!found) return { ok: false, error: 'Usuario o contraseña incorrectos.' };
    SmashLS.setItem(KEYS.SESSION_CLIENTE, usuario);
    return { ok: true, user: found };
  }

  function logoutCliente() {
    SmashLS.removeItem(KEYS.SESSION_CLIENTE);
  }

  function currentCliente() {
    const usuario = SmashLS.getItem(KEYS.SESSION_CLIENTE);
    if (!usuario) return null;
    const users = read(KEYS.USERS, []);
    return users.find((u) => u.usuario === usuario) || null;
  }

  /* ---------------- Staff (cocina/administración): login ---------------- */

  function loginStaff(usuario, password) {
    const staff = read(KEYS.STAFF, []);
    const found = staff.find(
      (u) => u.usuario.toLowerCase() === usuario.toLowerCase() && u.password === password
    );
    if (!found) return { ok: false, error: 'Usuario o contraseña de cocina incorrectos.' };
    SmashLS.setItem(KEYS.SESSION_STAFF, usuario);
    return { ok: true, user: found };
  }

  function logoutStaff() {
    SmashLS.removeItem(KEYS.SESSION_STAFF);
  }

  function currentStaff() {
    const usuario = SmashLS.getItem(KEYS.SESSION_STAFF);
    if (!usuario) return null;
    const staff = read(KEYS.STAFF, []);
    return staff.find((u) => u.usuario === usuario) || null;
  }

  /* ---------------- Productos (gestionados desde cocina) ---------------- */

  function getProducts({ soloActivos } = {}) {
    const list = read(KEYS.PRODUCTS, []);
    return soloActivos ? list.filter((p) => p.activo !== false) : list;
  }

  function getProductById(id) {
    return getProducts().find((p) => p.id === id) || null;
  }

  function slugify(name) {
    return (
      name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'producto'
    );
  }

  function addProduct({ name, desc, price, cost, img, categoria, sabores }) {
    const products = read(KEYS.PRODUCTS, []);
    let id = slugify(name);
    let n = 1;
    while (products.some((p) => p.id === id)) {
      id = slugify(name) + '-' + n++;
    }
    const product = {
      id,
      name,
      desc: desc || '',
      price: Number(price) || 0,
      cost: Number(cost) || 0,
      img: img || '',
      categoria: categoria || 'adicional',
      activo: true,
    };
    if (sabores && sabores.length) product.sabores = sabores;
    products.push(product);
    write(KEYS.PRODUCTS, products);
    return product;
  }

  function updateProduct(id, fields) {
    const products = read(KEYS.PRODUCTS, []);
    const idx = products.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    products[idx] = { ...products[idx], ...fields };
    write(KEYS.PRODUCTS, products);
    return true;
  }

  function deleteProduct(id) {
    const products = read(KEYS.PRODUCTS, []).filter((p) => p.id !== id);
    write(KEYS.PRODUCTS, products);
  }

  /* ---------------- Tarifa de domicilio ---------------- */

  function getDeliveryFee() {
    return read(KEYS.DELIVERY_FEE, 4000);
  }

  function setDeliveryFee(fee) {
    write(KEYS.DELIVERY_FEE, Number(fee) || 0);
  }

  /* ---------------- Pedidos ---------------- */

  function nextOrderId() {
    const seq = (read(KEYS.ORDER_SEQ, 0) || 0) + 1;
    write(KEYS.ORDER_SEQ, seq);
    return seq;
  }

  function createOrder({ clienteUsuario, clienteNombre, telefono, direccion, items, notas }) {
    const orders = read(KEYS.ORDERS, []);
    const subtotal = items.reduce((sum, it) => sum + it.price * it.qty, 0);
    const domicilio = getDeliveryFee();
    const order = {
      id: nextOrderId(),
      clienteUsuario: clienteUsuario || '',
      cliente: clienteNombre,
      telefono: telefono || '',
      direccion: direccion || '',
      items,
      notas: notas || '',
      subtotal,
      domicilio,
      total: subtotal + domicilio,
      status: 'nuevo', // nuevo -> preparando -> listo -> entregado
      creado: new Date().toISOString(),
    };
    orders.push(order);
    write(KEYS.ORDERS, orders);
    return order;
  }

  function getOrders() {
    return read(KEYS.ORDERS, []);
  }

  function getOrdersByCliente(usuario) {
    return getOrders().filter((o) => o.clienteUsuario === usuario);
  }

  function updateOrderStatus(id, status) {
    const orders = read(KEYS.ORDERS, []);
    const idx = orders.findIndex((o) => o.id === id);
    if (idx === -1) return false;
    orders[idx].status = status;
    write(KEYS.ORDERS, orders);
    return true;
  }

  function getOrderById(id) {
    return getOrders().find((o) => o.id === id) || null;
  }

  function isSameDay(isoDate, yyyyMMdd) {
    return isoDate.slice(0, 10) === yyyyMMdd;
  }

  function getOrdersByDate(yyyyMMdd) {
    return getOrders().filter((o) => isSameDay(o.creado, yyyyMMdd));
  }

  /* ---------------- Gastos fijos manuales por día (para Contabilidad) ---------------- */

  function getGastosDia(yyyyMMdd) {
    const all = read(KEYS.GASTOS_DIA, {});
    return all[yyyyMMdd] || { nomina: 170000, publicidad: 50000, servicios: 25000, otros: 0 };
  }

  function setGastosDia(yyyyMMdd, gastos) {
    const all = read(KEYS.GASTOS_DIA, {});
    all[yyyyMMdd] = gastos;
    write(KEYS.GASTOS_DIA, all);
  }

  return {
    KEYS,
    registerCliente,
    loginCliente,
    logoutCliente,
    currentCliente,
    loginStaff,
    logoutStaff,
    currentStaff,
    getProducts,
    getProductById,
    addProduct,
    updateProduct,
    deleteProduct,
    getDeliveryFee,
    setDeliveryFee,
    createOrder,
    getOrders,
    getOrdersByCliente,
    updateOrderStatus,
    getOrderById,
    getOrdersByDate,
    getGastosDia,
    setGastosDia,
  };
})();
