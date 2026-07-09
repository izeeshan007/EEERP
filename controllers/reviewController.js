import Review from '../models/Review.js';
import Order from '../models/Order.js';

export async function addReview(req, res) {
  try {
    const { productId } = req.params;
    const { rating, comment } = req.body;

    const pid = Number(productId);
    if (!pid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid product'
      });
    }

    const userEmail = req.user.email;
    const userId = req.user.id;

    // ✅ Check purchase (NUMERIC productId)
    const hasBought = await Order.exists({
      'items.productId': pid,
      buyerEmail: userEmail,
      status: 'Delivered'
    });

    if (!hasBought) {
      return res.status(403).json({
        success: false,
        error: 'You can review only delivered products'
      });
    }

    // ✅ Prevent duplicate review
    const exists = await Review.findOne({ productId: pid, userId });
    if (exists) {
      return res.status(400).json({
        success: false,
        error: 'You already reviewed this product'
      });
    }

    const review = await Review.create({
      productId: pid,
      userId,
      userEmail,
      rating,
      comment
    });

    res.json({ success: true, review });

  } catch (err) {
    console.error('addReview', err);
    res.status(500).json({
      success: false,
      error: 'Failed to add review'
    });
  }
}

export async function getReviewsByProduct(req, res) {
  try {
    const pid = Number(req.params.productId);

    if (!pid) {
      return res.json({ success: true, reviews: [] });
    }

    const reviews = await Review.find({ productId: pid })
      .sort({ createdAt: -1 });

    res.json({ success: true, reviews });

  } catch (err) {
    console.error('getReviews', err);
    res.status(500).json({
      success: false,
      error: 'Failed to load reviews'
    });
  }
}
