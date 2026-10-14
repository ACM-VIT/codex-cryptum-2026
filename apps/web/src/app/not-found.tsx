import Link from "next/link";
import { ArrowUpRight, Flag } from "lucide-react";
export default function NotFound() {
  return <div className="page empty-page"><Flag size={32} /><h1>Uncharted territory.</h1><p>This route doesn’t lead to a challenge.</p><Link href="/arena" className="button">Back to challenges <ArrowUpRight size={18} /></Link></div>;
}