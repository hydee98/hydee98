import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey, Transaction } from "@solana/web3.js";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import { buildInvestInstruction } from "../lib/anchorIx";
import { deriveAssetPda, lamportsToSol } from "../lib/solana";
import { RiskBadge } from "../components/RiskBadge";
import { StatusBadge } from "../components/StatusBadge";
import type {
  ChatMessage,
  DueDiligenceReport,
  RiskAssessment,
  RwaAsset,
  ValuationEstimate,
} from "../types";

/** Generic wrapper for the four independent AI panels below - each one is
 * "idle until you ask for it" so a page load never fires four Claude calls
 * a visitor didn't request. */
function useAiAction<T>(fn: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fn());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return { data, loading, error, run };
}

export function AssetDetail() {
  const { id } = useParams<{ id: string }>();
  const [asset, setAsset] = useState<RwaAsset | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api
      .getAsset(id)
      .then((res) => setAsset(res.asset))
      .catch((err) => setLoadError(err.message));
  }, [id]);

  const risk = useAiAction<RiskAssessment>(async () => {
    if (!id) throw new Error("missing asset id");
    return (await api.getRiskScore(id)).assessment;
  });
  const valuation = useAiAction<ValuationEstimate>(async () => {
    if (!id) throw new Error("missing asset id");
    return (await api.getValuation(id)).valuation;
  });
  const dueDiligence = useAiAction<DueDiligenceReport>(async () => {
    if (!id) throw new Error("missing asset id");
    return (await api.getDueDiligence(id)).report;
  });

  if (loadError) return <div className="page">Failed to load asset: {loadError}</div>;
  if (!asset) return <div className="page">Loading…</div>;

  return (
    <div className="page asset-detail">
      <div className="asset-detail-header">
        <div>
          <span className="asset-type">{asset.assetType}</span>
          <h1>{asset.name}</h1>
          <p className="asset-location">{asset.location}</p>
        </div>
        <div className="asset-detail-badges">
          <StatusBadge status={asset.status} />
          <RiskBadge score={asset.aiRiskScore} />
        </div>
      </div>

      <p className="asset-description">{asset.description}</p>

      <section className="panel">
        <h3>Supporting documents</h3>
        <ul>
          {asset.documents.map((doc, i) => (
            <li key={i}>{doc}</li>
          ))}
        </ul>
      </section>

      <div className="ai-panels">
        <AiPanel
          title="AI Risk Assessment"
          buttonLabel="Run risk assessment"
          state={risk}
          render={(r) => (
            <>
              <p>
                <strong>
                  {r.rating} risk - score {r.score}/100
                </strong>
              </p>
              <p>{r.summary}</p>
              <ul>
                {r.factors.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </>
          )}
        />

        <AiPanel
          title="AI Valuation Estimate"
          buttonLabel="Get valuation estimate"
          state={valuation}
          render={(v) => (
            <>
              <p>
                <strong>
                  Estimated: ${v.estimatedValueUsd.toLocaleString()} (range $
                  {v.lowUsd.toLocaleString()} - ${v.highUsd.toLocaleString()})
                </strong>
              </p>
              <p>{v.reasoning}</p>
            </>
          )}
        />

        <AiPanel
          title="AI Due Diligence Report"
          buttonLabel="Generate due diligence report"
          state={dueDiligence}
          render={(d) => (
            <>
              <p>{d.summary}</p>
              <p>
                <strong>Recommendation: {d.recommendation}</strong>
              </p>
              <div className="two-col">
                <div>
                  <h4>Strengths</h4>
                  <ul>
                    {d.strengths.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4>Risks</h4>
                  <ul>
                    {d.risks.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </>
          )}
        />
      </div>

      <ChatPanel assetId={asset.id} />

      <InvestPanel asset={asset} />

      <p className="disclaimer">
        This platform and its AI-generated content are for demonstration
        purposes only and do not constitute financial, legal, or investment
        advice.
      </p>
    </div>
  );
}

function AiPanel<T>({
  title,
  buttonLabel,
  state,
  render,
}: {
  title: string;
  buttonLabel: string;
  state: { data: T | null; loading: boolean; error: string | null; run: () => void };
  render: (data: T) => React.ReactNode;
}) {
  return (
    <section className="panel ai-panel">
      <div className="panel-header">
        <h3>{title}</h3>
        <button onClick={state.run} disabled={state.loading}>
          {state.loading ? "Thinking…" : state.data ? "Regenerate" : buttonLabel}
        </button>
      </div>
      {state.error && <p className="error-banner">{state.error}</p>}
      {state.data && render(state.data)}
      {!state.data && !state.error && !state.loading && (
        <p className="muted">Not yet generated for this asset.</p>
      )}
    </section>
  );
}

function ChatPanel({ assetId }: { assetId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    const trimmed = question.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(nextMessages);
    setQuestion("");
    try {
      const { answer } = await api.askQuestion(assetId, trimmed, messages);
      setMessages([...nextMessages, { role: "assistant", content: answer }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to get a response");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel">
      <h3>Ask about this asset</h3>
      <div className="chat-log">
        {messages.length === 0 && (
          <p className="muted">
            Ask a question about this asset's documentation, risk, or terms.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-message chat-${m.role}`}>
            <span className="chat-role">{m.role === "user" ? "You" : "Assistant"}</span>
            <p>{m.content}</p>
          </div>
        ))}
      </div>
      {error && <p className="error-banner">{error}</p>}
      <div className="chat-input-row">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="e.g. What's the biggest risk with this asset?"
          disabled={loading}
        />
        <button onClick={send} disabled={loading || !question.trim()}>
          {loading ? "Asking…" : "Ask"}
        </button>
      </div>
    </section>
  );
}

function InvestPanel({ asset }: { asset: RwaAsset }) {
  const { connection } = useConnection();
  const { publicKey, connected, sendTransaction } = useWallet();
  const [shares, setShares] = useState(1);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const remainingShares = asset.totalShares - asset.sharesSold;
  const costSol = useMemo(
    () => (shares * lamportsToSol(asset.pricePerShareLamports)).toFixed(4),
    [shares, asset.pricePerShareLamports]
  );

  const onChainReady = Boolean(asset.mint && asset.originator && asset.onChainAssetId !== null);
  const canInvest = asset.status === "Active" && remainingShares > 0;

  const handleInvest = async () => {
    setStatus(null);
    if (!connected || !publicKey) {
      setStatus("Connect a wallet first.");
      return;
    }
    if (!onChainReady) {
      setStatus(
        "This is a demo asset that hasn't been registered on-chain yet, so it has no real mint to invest into. See the README for how to deploy the program and register a real asset."
      );
      return;
    }
    setBusy(true);
    try {
      const ix = await buildInvestInstruction({
        originator: new PublicKey(asset.originator as string),
        assetId: BigInt(asset.onChainAssetId as number),
        assetPda: deriveAssetPda(
          new PublicKey(asset.originator as string),
          BigInt(asset.onChainAssetId as number)
        )[0],
        mint: new PublicKey(asset.mint as string),
        investor: publicKey,
        sharesAmount: BigInt(shares),
      });
      const tx = new Transaction().add(ix);
      const signature = await sendTransaction(tx, connection);
      setStatus(`Submitted: ${signature}. Waiting for confirmation…`);
      await connection.confirmTransaction(signature, "confirmed");
      setStatus(`Confirmed! Transaction: ${signature}`);
    } catch (err) {
      setStatus(err instanceof Error ? `Investment failed: ${err.message}` : "Investment failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel invest-panel">
      <h3>Invest</h3>
      {!onChainReady && (
        <p className="muted">
          Demo asset - not yet registered on-chain, so investing here is
          disabled. Deploy the Anchor program and call{" "}
          <code>register_asset</code> to make it investable.
        </p>
      )}
      {!canInvest && onChainReady && (
        <p className="muted">This asset isn't open for investment right now.</p>
      )}

      <div className="invest-controls">
        <label>
          Shares
          <input
            type="number"
            min={1}
            max={Math.max(remainingShares, 1)}
            value={shares}
            onChange={(e) => setShares(Math.max(1, Number(e.target.value)))}
            disabled={!canInvest}
          />
        </label>
        <p className="invest-cost">Cost: {costSol} SOL</p>
        {connected ? (
          <button onClick={handleInvest} disabled={!canInvest || busy}>
            {busy ? "Submitting…" : "Invest"}
          </button>
        ) : (
          <WalletMultiButton />
        )}
      </div>
      {status && <p className="invest-status">{status}</p>}
    </section>
  );
}
