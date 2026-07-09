import Product from '../models/Product.js';

/* CREATE */
export async function createProduct(req, res) {
  try {
    const { name, category, price } = req.body;

    if (!name || !category || !price) {
      return res.status(400).json({
        success: false,
        error: 'Name, category and price are required'
      });
    }

    if (req.body.description) {
      req.body.description = req.body.description.trim();
    }

    const product = await Product.create(req.body);
    res.json({ success: true, product });

  } catch (err) {
    console.error('createProduct', err);
    res.status(400).json({ success: false, error: err.message });
  }
}



/* READ (ADMIN) */
export async function getAllProductsAdmin(req, res) {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    res.json({ success: true, products });
  } catch (err) {
    console.error('getAllProductsAdmin', err);
    res.status(500).json({ success: false, error: 'Failed to load products' });
  }
}

/* UPDATE */
export async function updateProduct(req, res) {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true } // 👈 important
    );

    if (!product) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }

    res.json({ success: true, product });

  } catch (err) {
    console.error('updateProduct', err);
    res.status(400).json({ success: false, error: err.message });
  }
}


/* DELETE */
export async function deleteProduct(req, res) {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('deleteProduct', err);
    res.status(500).json({ success: false, error: 'Delete failed' });
  }
}

export async function deleteOrder(req, res) {
  try {
    const { id } = req.params;

    const deleted = await Order.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    return res.json({
      success: true,
      message: 'Order deleted'
    });
  } catch (err) {
    console.error('Delete order error:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to delete order'
    });
  }
}