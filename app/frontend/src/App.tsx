import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Link, Route, Routes } from "react-router-dom";
import { Browse } from "./pages/Browse";
import { CreateListing } from "./pages/CreateListing";
import { Disputes } from "./pages/Disputes";
import { ListingDetail } from "./pages/ListingDetail";
import { Orders } from "./pages/Orders";

export function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="brand">
          Market<span className="brand-accent">AI</span>
        </Link>
        <nav>
          <Link to="/">Browse</Link>
          <Link to="/sell">Sell</Link>
          <Link to="/orders">Orders</Link>
          <Link to="/disputes">Disputes</Link>
        </nav>
        <WalletMultiButton />
      </header>

      <main>
        <Routes>
          <Route path="/" element={<Browse />} />
          <Route path="/listing/:id" element={<ListingDetail />} />
          <Route path="/sell" element={<CreateListing />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/disputes" element={<Disputes />} />
        </Routes>
      </main>
    </div>
  );
}
