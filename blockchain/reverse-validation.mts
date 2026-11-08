import { validateTrade } from './trade-validation.mts';
import type { ReviewedTerms } from './trade-validation.mts';
export const validateUsdcSwap = (input: unknown, approvalOnly = false, reviewed?: ReviewedTerms) => validateTrade(input, approvalOnly, reviewed);
