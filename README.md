# Shop Risk Monitor

Run this to view the dashboard:

```powershell
.\start-dashboard.ps1
```

The dashboard tries the published Google Sheet CSV first. If that fails, it tries the Google Visualization endpoint, then `shop-risk-data.csv` from this same folder.

For daily local updates, run:

```powershell
.\refresh-shop-risk-data.ps1
```

You can schedule that script with Windows Task Scheduler. The Google Sheet must be published or otherwise accessible to the machine running the script.
