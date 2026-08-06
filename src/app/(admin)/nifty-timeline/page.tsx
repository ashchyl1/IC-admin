import { NiftyTimeline } from "@/components/nifty-timeline/NiftyTimeline";

/**
 * The recommendation timeline: six months of Nifty daily bars, each one wired
 * to the call that was live when it printed.
 *
 * Both inputs are files in the repo -- the transcribed casebook and the daily
 * series -- so there is nothing to fetch and nothing to cache-bust. That is the
 * point of the page: it reads one fixed document against one fixed window,
 * unlike /nifty-weekly, which is a live editable feed backed by Supabase.
 */
export default function NiftyTimelinePage() {
  return <NiftyTimeline />;
}
