# Scripts Directory

Utility scripts for development, testing, and deployment.

## Development Scripts

### `demo.py`
Demonstrates the scheduler functionality with sample data.
```bash
python scripts/demo.py
```

### `generate.py`
Generates a schedule from command-line arguments.
```bash
python scripts/generate.py --week-start 2025-11-25 --employees 10
```

### `analyze_feasibility.py`
Analyzes whether a given configuration is feasible.
```bash
python scripts/analyze_feasibility.py
```

### `diagnose_infeasibility.py`
Diagnoses why a schedule configuration is infeasible.
```bash
python scripts/diagnose_infeasibility.py
```

## Deployment Scripts

### `deploy.sh`
Deploys the application to Cloud Run and Firebase.
```bash
bash scripts/deploy.sh
```

### `setup_deployment.sh`
Sets up the deployment environment.
```bash
bash scripts/setup_deployment.sh
```

## Audit Scripts

### `audit.sh`
Audits the codebase for issues.
```bash
bash scripts/audit.sh
```

### `audit_fix.sh`
Automatically fixes common audit issues.
```bash
bash scripts/audit_fix.sh
```

## Firebase Management

### `populate_employees.py`
Populates Firebase with employee data.
```bash
python scripts/populate_employees.py
```

## Usage from Root Directory

All scripts should be run from the project root:

```bash
# From cs-scheduler-io-v2/
python scripts/demo.py
bash scripts/deploy.sh
```

## Dependencies

These scripts require dependencies from the root `requirements.txt`:
```bash
pip install -r requirements.txt
```

## Navigation

- [Back to Root](../)
- [Documentation](../docs/)
- [Archive](../archive/)
