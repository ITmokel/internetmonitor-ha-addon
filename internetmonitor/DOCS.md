# Internet Monitor

Monitor your internet connection with continuous ping tests, periodic speedtests, DNS lookups, and public IP tracking.

## Features

- **Ping Monitoring** — Continuous latency checks to configurable targets
- **Speedtest** — Periodic download/upload speed tests via Ookla's official CLI
- **DNS Resolution** — Track lookup times and success rates for custom domains
- **Public IP Tracking** — Detect IP changes with history
- **Real-time Dashboard** — Live status, interactive charts, time-range selection
- **Reports** — Daily breakdowns, worst-day analysis, detected outages
- **Smart pausing** — Ping checks are suspended during speedtests to prevent skewed data

## Configuration

All settings are managed through the **Configuration** tab in the web interface at `http://homeassistant.local:3000/config`. No add-on options need to be set in Home Assistant.

| Setting | Description | Default |
|---|---|---|
| Ping Interval | How often to run ping checks | 60 seconds |
| Speedtest Interval | How often to run speedtests | 60 minutes |
| Data Retention | How long to keep historical data | 365 days |
| DNS Check Interval | How often to run DNS lookups | 60 seconds |
| DNS Domains | Comma-separated list of domains to resolve | google.com, cloudflare.com, amazon.com |
| Public IP Interval | How often to check your public IP | 15 minutes |

## Web Interface

Access at `http://homeassistant.local:3000`

### Dashboard
- Stats cards: uptime, download/upload speed, latency, DNS resolution time, public IP
- Connection Status with per-target online/offline indicator and latency
- DNS Resolution status per domain
- Ping Latency chart with time range selector (5m → 7d) and All/Average view
- Speed Test History chart
- Target Statistics table with uptime % and average latency per target

### Reports
Period-based analytics (24h / 7d / 30d / 90d):
- Daily uptime bar chart
- Daily speed averages line chart
- Ping, DNS, and speedtest statistics tables
- Worst days by uptime
- Detected outage periods

### Configuration
- Adjust all monitoring intervals
- Add, enable/disable, and delete ping targets
- Test a host before adding it
- Cleanup old data (removes entries older than the retention period)

## Default Ping Targets

On first run, the following targets are added automatically:
- Google DNS (`8.8.8.8`)
- Cloudflare DNS (`1.1.1.1`)
- Example.com (`example.com`)

## Data Storage

All data is stored in `/data/internetmonitor.db` (SQLite). This persists across add-on restarts and updates.

## Support

For issues and feature requests, visit the repository.
