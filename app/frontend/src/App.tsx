import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Link, Route, Routes } from "react-router-dom";
import { AssetDetail } from "./pages/AssetDetail";
import { Marketplace } from "./pages/Marketplace";
import { Portfolio } from "./pages/Portfolio";

export function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="brand">
          RWA<span className="brand-accent">AI</span>
        </Link>
        <nav>
          <Link to="/">Marketplace</Link>
          <Link to="/portfolio">Portfolio</Link>
        </nav>
        <WalletMultiButton />
      </header>

      <main>
        <Routes>
          <Route path="/" element={<Marketplace />} />
          <Route path="/asset/:id" element={<AssetDetail />} />
          <Route path="/portfolio" element={<Portfolio />} />
        </Routes>
      </main>
    </div>
  );
}
