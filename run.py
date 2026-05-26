"""
GE Intelligence — Main Runner
Run this script to execute a full fetch + alert cycle.
Called by GitHub Actions on schedule, or manually on your laptop.

Usage:
    python run.py
"""

import sys
from fetcher import run_fetch_cycle
from alerts import run_alerts

def main():
    print("\n" + "█" * 60)
    print("  GE INTELLIGENCE SYSTEM")
    print("  RuneScape 3 Market Analysis")
    print("█" * 60)

    # Step 1: Fetch all data
    try:
        snapshot = run_fetch_cycle()
    except Exception as e:
        print(f"\n  FATAL: Fetch cycle failed: {e}")
        sys.exit(1)

    # Step 2: Run alerts
    try:
        alerts = run_alerts()
    except Exception as e:
        print(f"\n  FATAL: Alert engine failed: {e}")
        sys.exit(1)

    print("\n" + "█" * 60)
    print(f"  Cycle complete. {len(alerts)} alerts fired.")
    print("█" * 60 + "\n")

if __name__ == "__main__":
    main()
