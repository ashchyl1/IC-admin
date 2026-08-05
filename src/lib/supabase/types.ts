/**
 * Generated from the live Supabase schema. Do not hand-edit.
 * Regenerate with:  npm run db:types
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: { PostgrestVersion: "14.5" };
  public: {
    Tables: {
      instruments: {
        Row: {
          asset_type: string;
          created_at: string;
          currency: string;
          exchange: string;
          id: string;
          is_active: boolean;
          lot_size: number;
          name: string;
          symbol: string;
          tick_size: number;
          timezone: string;
        };
        Insert: {
          asset_type?: string;
          created_at?: string;
          currency?: string;
          exchange: string;
          id?: string;
          is_active?: boolean;
          lot_size?: number;
          name: string;
          symbol: string;
          tick_size?: number;
          timezone?: string;
        };
        Update: Partial<Database["public"]["Tables"]["instruments"]["Insert"]>;
        Relationships: [];
      };
      market_candles: {
        Row: {
          close: number;
          created_at: string;
          high: number;
          id: number;
          instrument_id: string;
          low: number;
          open: number;
          timeframe: string;
          ts: string;
          volume: number;
        };
        Insert: {
          close: number;
          created_at?: string;
          high: number;
          id?: never;
          instrument_id: string;
          low: number;
          open: number;
          timeframe: string;
          ts: string;
          volume?: number;
        };
        Update: Partial<Database["public"]["Tables"]["market_candles"]["Insert"]>;
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          default_currency: string;
          display_name: string | null;
          id: string;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          default_currency?: string;
          display_name?: string | null;
          id: string;
          timezone?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
      replay_sessions: {
        Row: {
          allow_reversal: boolean;
          allow_short: boolean;
          cash_balance: number;
          completed_at: string | null;
          created_at: string;
          currency: string;
          current_bar_index: number;
          current_simulated_at: string | null;
          default_quantity: number;
          end_ts: string;
          fee_config: Json;
          id: string;
          instrument_id: string;
          last_advance_request_id: string | null;
          market_close: string;
          market_open: string;
          name: string | null;
          slippage_config: Json;
          speed: number;
          start_ts: string;
          started_at: string | null;
          starting_capital: number;
          status: Database["public"]["Enums"]["replay_status"];
          timeframe: string;
          total_bars: number;
          user_id: string;
          warmup_bars: number;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      paper_orders: {
        Row: {
          cancelled_at: string | null;
          client_order_id: string;
          filled_at: string | null;
          id: string;
          is_close_request: boolean;
          order_type: string;
          quantity: number;
          reference_price: number | null;
          rejection_reason: string | null;
          session_id: string;
          side: Database["public"]["Enums"]["order_side"];
          simulated_submitted_at: string | null;
          status: Database["public"]["Enums"]["order_status"];
          submitted_at: string;
          submitted_bar_index: number;
          user_id: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      paper_fills: {
        Row: {
          avg_entry_after: number;
          bar_index: number;
          cash_after: number;
          created_at: string;
          fees: number;
          fill_price: number;
          id: string;
          instrument_id: string;
          order_id: string;
          position_after: number;
          quantity: number;
          raw_price: number;
          realized_pnl: number;
          session_id: string;
          side: Database["public"]["Enums"]["order_side"];
          simulated_ts: string;
          slippage_amount: number;
          user_id: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      paper_positions: {
        Row: {
          average_entry_price: number;
          id: string;
          instrument_id: string;
          realized_pnl: number;
          session_id: string;
          signed_quantity: number;
          total_fees: number;
          updated_at: string;
          user_id: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      trade_journal: {
        Row: {
          average_entry_price: number;
          average_exit_price: number | null;
          confidence: number | null;
          created_at: string;
          direction: Database["public"]["Enums"]["trade_direction"];
          entry_bar_index: number;
          entry_ts: string;
          exit_bar_index: number | null;
          exit_quantity: number;
          exit_ts: string | null;
          fees: number;
          gross_pnl: number;
          holding_bars: number | null;
          id: string;
          instrument_id: string;
          mae: number;
          mfe: number;
          mistake_category: string | null;
          net_pnl: number;
          notes: string | null;
          quantity: number;
          return_percentage: number | null;
          review: string | null;
          screenshot_path: string | null;
          session_id: string;
          setup: string | null;
          status: string;
          strategy: string | null;
          tags: string[] | null;
          trade_number: number;
          updated_at: string;
          user_id: string;
        };
        Insert: never;
        /** Only annotation columns are accepted; the DB trigger rejects the rest. */
        Update: {
          confidence?: number | null;
          mistake_category?: string | null;
          notes?: string | null;
          review?: string | null;
          screenshot_path?: string | null;
          setup?: string | null;
          strategy?: string | null;
          tags?: string[] | null;
        };
        Relationships: [];
      };
      equity_snapshots: {
        Row: {
          bar_index: number;
          cash: number;
          drawdown: number;
          equity: number;
          id: number;
          market_value: number;
          peak_equity: number;
          realized_pnl: number;
          session_id: string;
          simulated_ts: string;
          unrealized_pnl: number;
          user_id: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      nifty_weekly_recommendations: {
        Row: {
          bias: string;
          change_percent: number | null;
          change_points: number | null;
          chart_image_path: string | null;
          chart_image_url: string | null;
          created_at: string;
          explanatory_note: string;
          horizon: string;
          id: number;
          notes: string;
          recommendation_text: string;
          resistance_levels: Json;
          reversal_from: number | null;
          reversal_to: number | null;
          setup_status: string;
          spot_price: number | null;
          support_levels: Json;
          symbol: string;
          target_from: number | null;
          target_to: number | null;
          timeframe: string;
          trend: string;
          updated_at: string;
          week_ending: string;
        };
        Insert: {
          bias?: string;
          change_percent?: number | null;
          change_points?: number | null;
          chart_image_path?: string | null;
          chart_image_url?: string | null;
          created_at?: string;
          explanatory_note?: string;
          horizon?: string;
          id?: never;
          notes?: string;
          recommendation_text?: string;
          resistance_levels?: Json;
          reversal_from?: number | null;
          reversal_to?: number | null;
          setup_status?: string;
          spot_price?: number | null;
          support_levels?: Json;
          symbol?: string;
          target_from?: number | null;
          target_to?: number | null;
          timeframe?: string;
          trend?: string;
          updated_at?: string;
          week_ending: string;
        };
        Update: Partial<Database["public"]["Tables"]["nifty_weekly_recommendations"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      advance_replay: {
        Args: { p_bars?: number; p_request_id?: string; p_session_id: string };
        Returns: Json;
      };
      cancel_paper_order: {
        Args: { p_order_id: string };
        Returns: Database["public"]["Tables"]["paper_orders"]["Row"];
      };
      create_replay_session: {
        Args: {
          p_allow_reversal?: boolean;
          p_allow_short?: boolean;
          p_currency?: string;
          p_default_quantity?: number;
          p_end_ts: string;
          p_fee_config?: Json;
          p_instrument_id: string;
          p_market_close?: string;
          p_market_open?: string;
          p_name?: string;
          p_slippage_config?: Json;
          p_speed?: number;
          p_start_ts: string;
          p_starting_capital: number;
          p_timeframe: string;
          p_warmup_bars?: number;
        };
        Returns: Database["public"]["Tables"]["replay_sessions"]["Row"];
      };
      get_session_state: {
        Args: { p_session_id: string; p_since_bar?: number };
        Returns: Json;
      };
      restart_replay_session: { Args: { p_session_id: string }; Returns: Json };
      session_performance: { Args: { p_session_id: string }; Returns: Json };
      set_session_speed: {
        Args: { p_session_id: string; p_speed: number };
        Returns: Database["public"]["Tables"]["replay_sessions"]["Row"];
      };
      set_session_status: {
        Args: { p_session_id: string; p_status: string };
        Returns: Database["public"]["Tables"]["replay_sessions"]["Row"];
      };
      submit_paper_order: {
        Args: {
          p_client_order_id: string;
          p_is_close?: boolean;
          p_quantity: number;
          p_session_id: string;
          p_side: string;
        };
        Returns: Database["public"]["Tables"]["paper_orders"]["Row"];
      };
    };
    Enums: {
      order_side: "BUY" | "SELL";
      order_status: "pending" | "filled" | "cancelled" | "rejected";
      replay_status: "created" | "running" | "paused" | "completed" | "ended";
      trade_direction: "LONG" | "SHORT";
    };
    CompositeTypes: Record<never, never>;
  };
};

type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];

export type Instrument = Tables<"instruments">;
export type MarketCandle = Tables<"market_candles">;
export type ReplaySession = Tables<"replay_sessions">;
export type PaperOrder = Tables<"paper_orders">;
export type PaperFill = Tables<"paper_fills">;
export type PaperPosition = Tables<"paper_positions">;
export type TradeJournalEntry = Tables<"trade_journal">;
export type EquitySnapshot = Tables<"equity_snapshots">;
export type NiftyWeeklyRecommendationRow = Tables<"nifty_weekly_recommendations">;
export type OrderSide = Enums<"order_side">;
export type ReplayStatus = Enums<"replay_status">;
