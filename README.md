# Shop Review Monitor

Run this to view the dashboard:

```powershell
.\start-dashboard.ps1
```

The dashboard tries the published Google Sheet Visualization endpoint first. If that fails, it tries the shared-sheet Visualization endpoint, the published CSV endpoint, then `shop-review-data.csv` from this same folder.

For daily local updates, run:

```powershell
.\refresh-shop-review-data.ps1
```

You can schedule that script with Windows Task Scheduler. The Google Sheet must be published or otherwise accessible to the machine running the script.
