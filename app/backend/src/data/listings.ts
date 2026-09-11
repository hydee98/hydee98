import type { Listing } from "../types.js";

/**
 * In-memory demo listing store. A real deployment would read the canonical
 * listing list from the on-chain `Listing` accounts (see solanaService.ts)
 * and keep this only as an off-chain metadata cache (full description,
 * photos) keyed by the same id. Swap this module for a database without
 * touching the routes.
 */
const listings = new Map<string, Listing>();

function seed() {
  const demo: Listing[] = [
    {
      id: "listing-1",
      onChainListingId: 0,
      seller: null,
      category: "Property",
      listingType: "ForSale",
      title: "3-bed semi-detached house, Chorlton",
      description:
        "Well-presented three-bedroom semi in a popular Chorlton street, five minutes' walk from the metrolink. Recently renovated kitchen, south-facing garden, off-road parking for two cars. Chain-free.",
      location: "Manchester, M21",
      images: ["https://images.example/listing-1-a.jpg", "https://images.example/listing-1-b.jpg"],
      priceLamports: 2_850_000_000, // 2.85 SOL (demo escrow amount)
      guidePriceGBP: 285_000,
      status: "Active",
      aiFraudScore: 8,
      aiFraudFlags: [],
      createdAt: "2026-06-01T09:00:00.000Z",
    },
    {
      id: "listing-2",
      onChainListingId: 1,
      seller: null,
      category: "Property",
      listingType: "ToLet",
      title: "2-bed flat to rent, Northern Quarter",
      description:
        "Modern 2-bedroom apartment in the heart of the Northern Quarter. Available now, unfurnished. First month's rent + deposit held in escrow, released to the landlord once you confirm move-in.",
      location: "Manchester, M4",
      images: ["https://images.example/listing-2-a.jpg"],
      priceLamports: 22_000_000, // ~1 month rent + deposit, demo pricing
      guidePriceGBP: 1_100,
      status: "UnderOffer", // has a Funded order in progress - see data/orders.ts
      aiFraudScore: 15,
      aiFraudFlags: [],
      createdAt: "2026-06-10T14:00:00.000Z",
    },
    {
      id: "listing-3",
      onChainListingId: 2,
      seller: null,
      category: "Item",
      listingType: "ForSale",
      title: "iPhone 14 Pro, 256GB, mint condition",
      description:
        "Barely used iPhone 14 Pro in Deep Purple, 256GB. Always in a case with screen protector, battery health 96%. Comes with original box and charger. Local collection or shipped tracked.",
      location: "N/A",
      images: ["https://images.example/listing-3-a.jpg"],
      priceLamports: 6_500_000,
      guidePriceGBP: 650,
      status: "Active",
      aiFraudScore: 12,
      aiFraudFlags: [],
      createdAt: "2026-07-01T10:30:00.000Z",
    },
    {
      id: "listing-4",
      onChainListingId: 3,
      seller: null,
      category: "Item",
      listingType: "ForSale",
      title: "Brand new sealed laptops, half price, must sell today",
      description:
        "Got 5 brand new laptops sealed in box, selling half price because moving abroad tomorrow. No returns, no meetups, payment must be sent in full before shipping. Message me directly off-platform for the fastest deal.",
      location: "N/A",
      images: ["https://images.example/listing-4-a.jpg"],
      priceLamports: 4_000_000,
      guidePriceGBP: 400,
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
      seller: null,
      category: "Item",
      listingType: "ForSale",
      title: "Vintage 1978 Fender Telecaster",
      description:
        "Original 1978 Fender Telecaster, natural finish. Some finish checking consistent with age, frets recently professionally re-levelled. Comes with hard case and a copy of the original receipt.",
      location: "N/A",
      images: ["https://images.example/listing-5-a.jpg"],
      priceLamports: 18_000_000,
      guidePriceGBP: 1_800,
      status: "PendingReview",
      aiFraudScore: null,
      aiFraudFlags: [],
      createdAt: "2026-08-20T11:00:00.000Z",
    },
    {
      id: "listing-6",
      onChainListingId: 4,
      seller: null,
      category: "Item",
      listingType: "ForSale",
      title: "Mountain bike, full suspension",
      description:
        "2023 full-suspension mountain bike, size medium. Ridden maybe a dozen times. Selling as I've switched to road cycling.",
      location: "N/A",
      images: ["https://images.example/listing-6-a.jpg"],
      priceLamports: 3_200_000,
      guidePriceGBP: 320,
      status: "UnderOffer", // has a Disputed order in progress - see data/orders.ts
      aiFraudScore: 18,
      aiFraudFlags: [],
      createdAt: "2026-07-28T13:00:00.000Z",
    },
  ];

  for (const listing of demo) listings.set(listing.id, listing);
}
seed();

export function listListings(): Listing[] {
  return Array.from(listings.values());
}

export function getListing(id: string): Listing | undefined {
  return listings.get(id);
}

export function createListing(
  input: Omit<
    Listing,
    "id" | "createdAt" | "status" | "aiFraudScore" | "aiFraudFlags" | "onChainListingId" | "seller"
  >
): Listing {
  const id = `listing-${listings.size + 1}-${Date.now().toString(36)}`;
  const listing: Listing = {
    ...input,
    id,
    onChainListingId: null,
    seller: null,
    status: "PendingReview",
    aiFraudScore: null,
    aiFraudFlags: [],
    createdAt: new Date().toISOString(),
  };
  listings.set(id, listing);
  return listing;
}

export function updateListing(id: string, patch: Partial<Listing>): Listing | undefined {
  const existing = listings.get(id);
  if (!existing) return undefined;
  const updated = { ...existing, ...patch };
  listings.set(id, updated);
  return updated;
}
