import { motion } from 'motion/react';
import { getProviderVisual } from '../ProviderBadge';
import type { ProviderId } from '../../shared/types';

export interface FilterModelChip {
  compositeId: string;
  providerId: ProviderId;
  label: string;
}

export function RoundNav({
  filterModels,
  selectedFilter,
  onSelectFilter,
  rounds,
  activeRound,
  onSelectRound,
  isChatMode,
}: {
  filterModels: FilterModelChip[];
  selectedFilter: string;
  onSelectFilter: (id: string) => void;
  rounds: number[];
  activeRound: number | null;
  onSelectRound: (round: number) => void;
  isChatMode: boolean;
}) {
  return (
    <div className="w-full shrink-0 border-b border-white/[0.06] bg-white/[0.02] px-3 sm:px-5 py-1.5 flex items-center justify-between gap-2 overflow-x-auto">
      {/* Per-Model Filter Chips */}
      <div className="flex items-center gap-1.5 overflow-x-auto">
        {filterModels.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => onSelectFilter('all')}
              className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                selectedFilter === 'all'
                  ? 'bg-[rgba(124,77,232,0.25)] border-[rgba(167,139,250,0.6)] text-[#F4F7FD]'
                  : 'bg-white/[0.04] border-white/10 text-[#B4BFD4] hover:text-white hover:bg-white/[0.08]'
              }`}
            >
              All
            </button>

            {filterModels.map((m) => {
              const visual = getProviderVisual(m.providerId);
              const active = selectedFilter === m.compositeId;
              return (
                <button
                  key={m.compositeId}
                  type="button"
                  onClick={() => onSelectFilter(active ? 'all' : m.compositeId)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-[rgba(124,77,232,0.25)] border-[rgba(167,139,250,0.6)] text-[#F4F7FD]'
                      : 'bg-white/[0.04] border-white/10 text-[#B4BFD4] hover:text-white hover:bg-white/[0.08]'
                  }`}
                  title={m.compositeId}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: visual.accentHex }}
                  />
                  <span>{m.label}</span>
                </button>
              );
            })}
          </>
        )}
      </div>

      {/* Debate / Multi-Round Sticky Anchor Chips */}
      {!isChatMode && rounds.length > 0 && (
        <nav
          aria-label="Round navigation"
          className="flex items-center gap-1 p-0.5 rounded-full bg-white/[0.04] border border-white/10 shrink-0"
        >
          {rounds.map((r) => {
            const isActive = activeRound === r;
            return (
              <button
                key={r}
                type="button"
                onClick={() => onSelectRound(r)}
                className={`relative px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  isActive ? 'text-[#F4F7FD]' : 'text-[#9AA7BF] hover:text-[#E6EBF5]'
                }`}
              >
                {isActive && (
                  <motion.span
                    layoutId="council-active-round"
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                    className="absolute inset-0 rounded-full bg-white/12 border border-white/20"
                  />
                )}
                <span className="relative z-10">R{r}</span>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}
