import { validateTrade } from './trade-validation.mts';
export const validateUsdcSwap = (input: unknown, approvalOnly = false) => validateTrade(input, approvalOnly);
