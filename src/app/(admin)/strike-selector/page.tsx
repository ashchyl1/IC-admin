import { StrikeSelector } from "@/components/strike-selector/StrikeSelector";

/**
 * Everything here is computed in the browser from the form — there is no chain
 * feed and no database read — so the page is a static shell around one client
 * component and needs no dynamic rendering.
 */
export default function StrikeSelectorPage() {
  return <StrikeSelector />;
}
