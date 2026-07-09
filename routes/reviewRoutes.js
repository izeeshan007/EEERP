import express from 'express';
import { addReview, getReviewsByProduct } from '../controllers/reviewController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/:productId', getReviewsByProduct);
router.post('/:productId', authMiddleware, addReview);

export default router;

