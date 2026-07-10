#!/bin/bash
# Pre-Deployment Setup Script
# Run this ONCE before the first deployment

set -e

echo "🔧 CS Scheduler - Pre-Deployment Setup"
echo "======================================"
echo ""

# 1. Check gcloud
echo "1️⃣  Checking gcloud CLI..."
if ! command -v gcloud &> /dev/null; then
    echo "❌ gcloud CLI not found"
    echo "📥 Install from: https://cloud.google.com/sdk/docs/install"
    echo "   macOS: brew install --cask google-cloud-sdk"
    exit 1
fi
echo "✅ gcloud CLI found"

# 2. Check Docker
echo ""
echo "2️⃣  Checking Docker..."
if ! command -v docker &> /dev/null; then
    echo "❌ Docker not found"
    echo "📥 Install from: https://www.docker.com/products/docker-desktop"
    exit 1
fi
echo "✅ Docker found"

# 3. Get PROJECT_ID
echo ""
echo "3️⃣  Getting PROJECT_ID..."
PROJECT_ID=$(gcloud config list --format="value(core.project)" 2>/dev/null || echo "")
if [ -z "$PROJECT_ID" ]; then
    echo "❌ PROJECT_ID not set"
    echo "🔧 Run: gcloud config set project YOUR_PROJECT_ID"
    exit 1
fi
echo "✅ PROJECT_ID: $PROJECT_ID"

# 4. Check authentication
echo ""
echo "4️⃣  Checking gcloud authentication..."
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q "@"; then
    echo "❌ Not authenticated"
    echo "🔧 Run: gcloud auth login"
    exit 1
fi
echo "✅ Authenticated"

# 5. Enable APIs
echo ""
echo "5️⃣  Enabling required APIs..."
echo "   Enabling Cloud Run..."
gcloud services enable run.googleapis.com --quiet
echo "   Enabling Artifact Registry..."
gcloud services enable artifactregistry.googleapis.com --quiet
echo "✅ APIs enabled"

# 6. Check/Create Artifact Repository
echo ""
echo "6️⃣  Checking Artifact Repository..."
if gcloud artifacts repositories describe cs-scheduler-repo \
    --location=europe-west1 \
    --format="value(name)" &>/dev/null; then
    echo "✅ Repository exists"
else
    echo "📦 Creating Artifact Repository..."
    gcloud artifacts repositories create cs-scheduler-repo \
        --repository-format=docker \
        --location=europe-west1 \
        --quiet
    echo "✅ Repository created"
fi

# 7. Configure Docker authentication
echo ""
echo "7️⃣  Configuring Docker authentication..."
gcloud auth configure-docker europe-west1-docker.pkg.dev --quiet
echo "✅ Docker auth configured"

# Success
echo ""
echo "════════════════════════════════════════"
echo "✅ ALL SETUP COMPLETE!"
echo "════════════════════════════════════════"
echo ""
echo "You're ready to deploy! Run:"
echo ""
echo "  ./deploy.sh $PROJECT_ID"
echo ""
