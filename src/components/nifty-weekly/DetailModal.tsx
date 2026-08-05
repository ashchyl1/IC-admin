"use client";
import * as React from "react";
import { ImageOff } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { ZoomableImage } from "@/components/ui/ZoomableImage";
import type { Recommendation } from "@/lib/nifty-weekly/schema";
import { StructuredPanel, formatWeek } from "./StructuredPanel";

interface Props {
  rec: Recommendation | null;
  onClose: () => void;
}

/**
 * The expanded card: same left/right split, but the chart gets real estate and
 * the analysis is no longer clamped. The image itself stays click-to-zoom via
 * ZoomableImage, which portals above this modal.
 */
export function DetailModal({ rec, onClose }: Props) {
  return (
    <Modal
      open={rec !== null}
      onClose={onClose}
      labelledBy="rec-detail-title"
      className="kite-theme max-w-6xl"
    >
      {rec && (
        <>
          <div className="border-b px-5 py-3.5 pr-14">
            <h2 id="rec-detail-title" className="text-base font-semibold text-foreground">
              {rec.symbol} {rec.timeframe} — week ending {formatWeek(rec.weekEnding)}
            </h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <div className="flex items-center justify-center border-b bg-muted p-3 lg:border-b-0 lg:border-r">
              {rec.chartImageUrl ? (
                <ZoomableImage
                  src={rec.chartImageUrl}
                  alt={`${rec.symbol} ${rec.timeframe} chart for the week ending ${rec.weekEnding}`}
                  className="max-h-[70vh] w-full"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
                  <ImageOff className="h-7 w-7" />
                  <span className="text-[13px]">No chart image</span>
                </div>
              )}
            </div>

            <div className="max-h-[70vh] overflow-y-auto p-5">
              <StructuredPanel rec={rec} variant="detail" />
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
