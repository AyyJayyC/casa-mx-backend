/**
 * Credits Service
 *
 * Manages the Casa MX credit system backed by Stripe for purchases.
 * Credits are used by landlords/sellers to: upload properties, blast listings,
 * promote listings, and access buyer WhatsApp numbers.
 *
 * Note: Stripe is imported using require() due to its CJS constructor export
 * pattern being incompatible with ESM TypeScript targeting.
 */

import { env } from '../config/env.js';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const StripeLib = require('stripe') as any;

function getStripeClient() {
  if (!env.STRIPE_SECRET_KEY) {
    return null;
  }
  return new StripeLib(env.STRIPE_SECRET_KEY, { apiVersion: '2024-04-10' });
}

export interface CreateCheckoutSessionOptions {
  userId: string;
  credits: number;
  pricePerCredit: number; // in cents
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSession {
  sessionId: string;
  url: string;
}

/**
 * Create a Stripe Checkout session for purchasing credits.
 */
export async function createCreditCheckoutSession(
  options: CreateCheckoutSessionOptions
): Promise<CheckoutSession> {
  const stripe = getStripeClient();

  if (!stripe) {
    throw new Error('Stripe is not configured. Set STRIPE_SECRET_KEY in your environment.');
  }

  const { userId, credits, pricePerCredit, successUrl, cancelUrl } = options;
  const totalAmount = credits * pricePerCredit;

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'mxn',
          product_data: {
            name: `Casa MX Credits x${credits}`,
            description: `${credits} Casa MX credits for listings, promotions, and messaging`,
          },
          unit_amount: totalAmount,
        },
        quantity: 1,
      },
    ],
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      userId,
      credits: credits.toString(),
    },
  });

  return { sessionId: session.id, url: session.url };
}

/**
 * Verify a Stripe webhook event signature and return the parsed event.
 */
export function constructStripeEvent(
  payload: Buffer | string,
  signature: string,
  webhookSecret: string
): any {
  const stripe = getStripeClient();

  if (!stripe) {
    throw new Error('Stripe is not configured');
  }

  return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
}
