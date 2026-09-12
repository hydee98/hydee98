import { Link, NavLink, Route, Routes } from "react-router-dom";
import { AccountStatus } from "./components/AccountStatus";
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
          <NavLink to="/" end>
            Browse
          </NavLink>
          <NavLink to="/sell">Sell</NavLink>
          <NavLink to="/orders">Orders</NavLink>
          <NavLink to="/disputes">Disputes</NavLink>
        </nav>
        <AccountStatus />
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
