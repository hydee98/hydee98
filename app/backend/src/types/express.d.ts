// Augments Express's Request type with the identity requireAuth attaches.
export {};

declare global {
  namespace Express {
    interface Request {
      auth?: { publicKey: string };
    }
  }
}
