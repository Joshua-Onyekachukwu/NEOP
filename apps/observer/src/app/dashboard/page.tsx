'use client';

import { useState, useEffect } from 'react';

/**
 * Observer Dashboard — Public live election view.
 * Observers don't need to log in; they just view the live results.
 */

interface PartyResult {
  name: string;
  abbreviation: string;
  color: string;
  total_votes: number;
  percentage: number;
}

interface GlobalStats {
  inec_total_polling_units: number;
  covered_polling_units: number;
  verified_polling_units: number;
  total_votes: number;
  coverage_percent: number;
}

export default function ObserverDashboard() {
  const [parties, setParties] = useState<PartyResult[]>([]);
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  // Monitor online status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    setIsOnline(navigator.onLine);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Fetch live data from public API
  const fetchData = async () => {
    try {
      const [partyRes, statsRes] = await Promise.all([
        fetch('/api/public/party-results'),
        fetch('/api/public/stats'),
      ]);
      if (partyRes.ok) {
        const data = await partyRes.json();
        setParties(data.parties || []);
      }
      if (statsRes.ok) {
        const data = await statsRes.json();
        setStats({
          inec_total_polling_units: data.inec_total_polling_units || 176846,
          covered_polling_units: data.covered_polling_units || 0,
          verified_polling_units: data.verified_polling_units || 0,
          total_votes: data.total_votes || 0,
          coverage_percent: data.coverage_percent || 0,
        });
      }
      setLastUpdated(new Date().toLocaleTimeString());
    } catch {}
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  const grandTotal = parties.reduce((sum, p) => sum + (p.total_votes || 0), 0);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Offline banner */}
      {!isOnline && (
        <div className="bg-red-600 text-white text-center py-2 text-sm font-bold">
          ⚠ Offline — Data may not be current
        </div>
      )}

      {/* Header */}
      <div className="bg-[#1B5E20] px-4 py-4 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">Nigeria Election Live</h1>
            <p className="text-xs opacity-75">Presidential Election 2027</p>
          </div>
          <div className="text-right">
            <div className="text-xs opacity-75">Last updated</div>
            <div className="text-sm font-mono">{lastUpdated || '---'}</div>
          </div>
        </div>
      </div>

      {/* Stats Bar */}
      {stats && (
        <div className="bg-white border-b border-gray-200 px-4 py-3">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-lg font-bold text-[#1B5E20]">
                {stats.coverage_percent.toFixed(1)}%
              </div>
              <div className="text-xs text-gray-500">Coverage</div>
            </div>
            <div>
              <div className="text-lg font-bold">
                {stats.covered_polling_units.toLocaleString()}
              </div>
              <div className="text-xs text-gray-500">PUs Reported</div>
            </div>
            <div>
              <div className="text-lg font-bold">
                {grandTotal > 0 ? (grandTotal / 1_000_000).toFixed(1) + 'M' : '0'}
              </div>
              <div className="text-xs text-gray-500">Total Votes</div>
            </div>
          </div>
        </div>
      )}

      {/* Party Results */}
      <div className="p-4">
        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">
          Party Results
        </h2>
        {parties.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <div className="text-4xl mb-2">⏳</div>
            <p className="text-sm">Waiting for election data...</p>
          </div>
        ) : (
          <div className="space-y-3">
            {parties.map((party, i) => (
              <div key={party.abbreviation} className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: party.color }}
                    />
                    <span className="font-bold text-gray-900">
                      {party.abbreviation}
                    </span>
                    <span className="text-xs text-gray-500 hidden sm:inline">
                      {party.name}
                    </span>
                  </div>
                  <span className="font-mono font-bold">
                    {party.percentage}%
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-3">
                  <div
                    className="h-3 rounded-full transition-all duration-700"
                    style={{
                      width: `${Math.min(party.percentage, 100)}%`,
                      backgroundColor: party.color,
                    }}
                  />
                </div>
                <div className="mt-2 text-right font-mono text-sm text-gray-600">
                  {party.total_votes.toLocaleString()} votes
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-6 text-center text-xs text-gray-400">
        These are independently collected field observations and are not official INEC election results.
      </div>
    </div>
  );
}
