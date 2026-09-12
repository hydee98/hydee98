import { feeUsdFor, usdToCurrencyAmount } from "../services/pricingService.js";
import type { Listing, Order } from "../types.js";

/**
 * Demo seed data - plain arrays, no side effects. Used to populate the
 * in-memory store on every boot (no DATABASE_URL) and to seed the database
 * exactly once, the first time it's empty (see db/migrate.ts).
 *
 * The seed listings/orders below carry placeholder wallet addresses
 * (freshly generated keypairs whose private keys were discarded) so the
 * UI has something realistic to display. Nobody can sign in as these
 * demo sellers/buyers - a real visitor creates their own listings/orders
 * under their own connected wallet, which are then fully interactive.
 */

const DEMO_SELLER_1 = "7QvZcMBn1r2zzC1RCa7QsqNUKe6MUde4RxCis5a1Bbgv";
const DEMO_SELLER_2 = "4Zgqy6cqfjhrdZ8xvdxveHBMbtxyoB7jFYruM5vKPz2h";
const DEMO_BUYER_1 = "9tPqR3vLh2cQe7zK4nXw8bYfGdMsUvT1oAiWkC6xEjHp";

export const seedListings: Listing[] = [
  {
    id: "listing-1",
    onChainListingId: 0,
    seller: DEMO_SELLER_1,
    category: "Property",
    listingType: "ForSale",
    title: "3-bed semi-detached house, Chorlton",
    description:
      "Well-presented three-bedroom semi in a popular Chorlton street, five minutes' walk from the metrolink. Recently renovated kitchen, south-facing garden, off-road parking for two cars. Chain-free.",
    location: "Manchester, M21",
    images: ["https://images.example/listing-1-a.jpg", "https://images.example/listing-1-b.jpg"],
    priceUsd: 285_000,
    status: "Active",
    aiFraudScore: 8,
    aiFraudFlags: [],
    createdAt: "2026-06-01T09:00:00.000Z",
  },
  {
    id: "listing-2",
    onChainListingId: 1,
    seller: DEMO_SELLER_1,
    category: "Property",
    listingType: "ToLet",
    title: "2-bed flat to rent, Northern Quarter",
    description:
      "Modern 2-bedroom apartment in the heart of the Northern Quarter. Available now, unfurnished. First month's rent + deposit held in escrow, released to the landlord once you confirm move-in.",
    location: "Manchester, M4",
    images: ["https://images.example/listing-2-a.jpg"],
    priceUsd: 1_100, // ~1 month rent + deposit, demo pricing
    status: "UnderOffer", // has a Funded order in progress - see seedOrders below
    aiFraudScore: 15,
    aiFraudFlags: [],
    createdAt: "2026-06-10T14:00:00.000Z",
  },
  {
    id: "listing-3",
    onChainListingId: 2,
    seller: DEMO_SELLER_2,
    category: "Item",
    listingType: "ForSale",
    title: "iPhone 14 Pro, 256GB, mint condition",
    description:
      "Barely used iPhone 14 Pro in Deep Purple, 256GB. Always in a case with screen protector, battery health 96%. Comes with original box and charger. Local collection or shipped tracked.",
    location: "N/A",
    images: ["https://images.example/listing-3-a.jpg"],
    priceUsd: 650,
    status: "Active",
    aiFraudScore: 12,
    aiFraudFlags: [],
    createdAt: "2026-07-01T10:30:00.000Z",
  },
  {
    id: "listing-4",
    onChainListingId: 3,
    seller: DEMO_SELLER_2,
    category: "Item",
    listingType: "ForSale",
    title: "Brand new sealed laptops, half price, must sell today",
    description:
      "Got 5 brand new laptops sealed in box, selling half price because moving abroad tomorrow. No returns, no meetups, payment must be sent in full before shipping. Message me directly off-platform for the fastest deal.",
    location: "N/A",
    images: ["https://images.example/listing-4-a.jpg"],
    priceUsd: 400,
    status: "Flagged",
    aiFraudScore: 88,
    aiFraudFlags: [
      "Pressure tactics (\"must sell today\")",
      "Discourages platform escrow / pushes off-platform payment",
      "No-returns + unusually steep discount combination",
      "Seller has no listing history",
    ],
    createdAt: "2026-07-15T18:20:00.000Z",
  },
  {
    id: "listing-5",
    onChainListingId: null,
    seller: DEMO_SELLER_2,
    category: "Item",
    listingType: "ForSale",
    title: "Vintage 1978 Fender Telecaster",
    description:
      "Original 1978 Fender Telecaster, natural finish. Some finish checking consistent with age, frets recently professionally re-levelled. Comes with hard case and a copy of the original receipt.",
    location: "N/A",
    images: ["https://images.example/listing-5-a.jpg"],
    priceUsd: 1_800,
    status: "PendingReview",
    aiFraudScore: null,
    aiFraudFlags: [],
    createdAt: "2026-08-20T11:00:00.000Z",
  },
  {
    id: "listing-6",
    onChainListingId: 4,
    seller: DEMO_SELLER_1,
    category: "Item",
    listingType: "ForSale",
    title: "Mountain bike, full suspension",
    description:
      "2023 full-suspension mountain bike, size medium. Ridden maybe a dozen times. Selling as I've switched to road cycling.",
    location: "N/A",
    images: ["https://images.example/listing-6-a.jpg"],
    priceUsd: 320,
    status: "UnderOffer", // has a Disputed order in progress - see seedOrders below
    aiFraudScore: 18,
    aiFraudFlags: [],
    createdAt: "2026-07-28T13:00:00.000Z",
  },
];

export const seedOrders: Order[] = [
  {
    id: "order-1",
    onChainOrderId: 0,
    listingId: "listing-2",
    buyerWallet: DEMO_BUYER_1,
    amountUsd: 1_100,
    // Paid with SOL - swapped into USDC in the buyer's own wallet before
    // create_order (see lib/jupiterSwap.ts), so escrow only ever holds USDC.
    paymentCurrency: "SOL",
    paymentAmount: usdToCurrencyAmount(1_100, "SOL"),
    feeUsd: feeUsdFor(1_100),
    status: "Funded",
    disputeReasonUri: null,
    disputeMessages: [],
    createdAt: "2026-08-25T09:00:00.000Z",
  },
  {
    id: "order-2",
    onChainOrderId: 0,
    listingId: "listing-6",
    buyerWallet: DEMO_BUYER_1,
    amountUsd: 320,
    paymentCurrency: "USDC", // paid directly in USDC, no swap needed
    paymentAmount: usdToCurrencyAmount(320, "USDC"),
    feeUsd: feeUsdFor(320),
    status: "Disputed",
    disputeReasonUri: "ipfs://dispute-evidence-order-2",
    disputeMessages: [
      {
        author: "buyer",
        content:
          "The bike arrived with a cracked frame near the rear shock mount - not mentioned in the listing at all. I have photos. I don't think this is safe to ride and I'd like a refund.",
        createdAt: "2026-08-29T10:00:00.000Z",
      },
      {
        author: "seller",
        content:
          "The bike left me in perfect condition - I have a video from the day before shipping showing no damage. This must have happened in transit with the courier, not something I did.",
        createdAt: "2026-08-29T15:30:00.000Z",
      },
      {
        author: "buyer",
        content:
          "The box itself wasn't damaged at all, no crush marks, which is why I don't think this was a shipping issue. Still happy to share my unboxing photos for reference.",
        createdAt: "2026-08-29T16:10:00.000Z",
      },
    ],
    createdAt: "2026-08-27T11:00:00.000Z",
  },
];
