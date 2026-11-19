import { Link } from "react-router-dom";
import { Orb } from "../components/brand/Orb";
import { Button } from "../components/ui/Button";

export default function NotFound() {
  return (
    <div className="grid min-h-full place-items-center px-6 py-16 text-center">
      <div className="flex flex-col items-center">
        <Orb variant="small" />
        <p className="mt-6 font-mono text-xs text-muted">404 · no page at this address</p>
        <h1 className="mt-2 font-display text-[40px] leading-[44px]">Nothing quoted here.</h1>
        <p className="mt-2 max-w-sm text-[14px] text-muted">The link may be old, or the page was moved when the app went under /app.</p>
        <div className="mt-6 flex gap-2">
          <Link to="/app"><Button variant="primary">Open the app</Button></Link>
          <Link to="/"><Button>Home</Button></Link>
        </div>
      </div>
    </div>
  );
}
