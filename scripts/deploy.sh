#!/bin/bash

# CS Scheduler Deployment Script

set -e  # Exit on any error

echo "🚀 CS Scheduler Deployment Script"
echo "=================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're in the right directory
if [ ! -f "scheduler.py" ]; then
    print_error "Please run this script from the project root directory"
    exit 1
fi

print_status "Starting deployment process..."

# 1. Build React frontend
print_status "Building React frontend..."
cd scheduler-ui

if [ ! -d "node_modules" ]; then
    print_status "Installing Node.js dependencies..."
    npm install
fi

print_status "Building production React app..."
npm run build

if [ ! -d "dist" ]; then
    print_error "React build failed - dist directory not found"
    exit 1
fi

cd ..
print_success "React frontend built successfully"

# 2. Build Docker image
print_status "Building Docker image..."
IMAGE_NAME="cs-scheduler"
IMAGE_TAG="latest"

docker build -t "${IMAGE_NAME}:${IMAGE_TAG}" .

if [ $? -eq 0 ]; then
    print_success "Docker image built successfully: ${IMAGE_NAME}:${IMAGE_TAG}"
else
    print_error "Docker build failed"
    exit 1
fi

# 3. Test Docker image
print_status "Testing Docker image..."
CONTAINER_ID=$(docker run -d -p 8001:8000 "${IMAGE_NAME}:${IMAGE_TAG}")

# Give the container time to start
sleep 5

# Test health endpoint
if curl -f http://localhost:8001/api/health > /dev/null 2>&1; then
    print_success "Docker container is running and healthy"
else
    print_error "Docker container health check failed"
    docker logs $CONTAINER_ID
    docker stop $CONTAINER_ID
    docker rm $CONTAINER_ID
    exit 1
fi

# Clean up test container
docker stop $CONTAINER_ID > /dev/null
docker rm $CONTAINER_ID > /dev/null

# 4. Firebase deployment preparation
print_status "Preparing Firebase deployment..."

if command -v firebase &> /dev/null; then
    print_status "Firebase CLI found"
    
    if [ -f "firebase.json" ]; then
        print_status "Firebase configuration found"
        print_warning "To deploy to Firebase:"
        echo "  1. Run: firebase login"  
        echo "  2. Run: firebase deploy"
        echo "  3. Or run: firebase deploy --only hosting,functions"
    else
        print_warning "Firebase configuration not found. Run 'firebase init' first."
    fi
else
    print_warning "Firebase CLI not found. Install with: npm install -g firebase-tools"
fi

# 5. Summary
echo ""
print_success "Deployment preparation complete!"
echo ""
echo "Available deployment options:"
echo "  🐳 Docker: docker run -p 8000:8000 ${IMAGE_NAME}:${IMAGE_TAG}"
echo "  🔥 Firebase: firebase deploy (after firebase login)"
echo "  📦 Docker Compose: docker-compose up"
echo ""
print_status "Docker image: ${IMAGE_NAME}:${IMAGE_TAG}"
print_status "Frontend build: scheduler-ui/dist/"
print_status "All ready for deployment! 🎉"