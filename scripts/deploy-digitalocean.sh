#!/bin/bash

# Universal LLM Slack Hub - DigitalOcean Deployment Script
# Optimized for DigitalOcean Droplets and App Platform

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="universal-llm-hub"
DOCKER_REGISTRY="registry.digitalocean.com"
DROPLET_SIZE="s-2vcpu-4gb"  # Minimum recommended for LLM processing
REGION="nyc3"               # Change to your preferred region

echo -e "${GREEN}🚀 Universal LLM Slack Hub - DigitalOcean Deployment${NC}"
echo "=================================================="

# Check if we're running on DigitalOcean
if [ -f /etc/digitalocean_deployment ]; then
    echo -e "${GREEN}✅ Running on DigitalOcean infrastructure${NC}"
    DEPLOYMENT_TYPE="droplet"
else
    echo -e "${YELLOW}⚠️  Local deployment to DigitalOcean${NC}"
    DEPLOYMENT_TYPE="local"
fi

# Function to check required tools
check_requirements() {
    echo -e "${YELLOW}🔍 Checking requirements...${NC}"

    local required_tools=("docker" "docker-compose" "doctl")
    local missing_tools=()

    for tool in "${required_tools[@]}"; do
        if ! command -v $tool &> /dev/null; then
            missing_tools+=($tool)
        fi
    done

    if [ ${#missing_tools[@]} -ne 0 ]; then
        echo -e "${RED}❌ Missing required tools: ${missing_tools[*]}${NC}"
        echo "Please install missing tools and try again."

        if [[ " ${missing_tools[*]} " =~ " doctl " ]]; then
            echo "Install doctl: https://docs.digitalocean.com/reference/doctl/how-to/install/"
        fi

        exit 1
    fi

    echo -e "${GREEN}✅ All requirements satisfied${NC}"
}

# Function to authenticate with DigitalOcean
authenticate_do() {
    echo -e "${YELLOW}🔐 Authenticating with DigitalOcean...${NC}"

    if ! doctl auth list | grep -q "current context"; then
        echo -e "${RED}❌ Not authenticated with DigitalOcean${NC}"
        echo "Run: doctl auth init"
        exit 1
    fi

    echo -e "${GREEN}✅ DigitalOcean authentication verified${NC}"
}

# Function to setup container registry
setup_registry() {
    echo -e "${YELLOW}📦 Setting up Container Registry...${NC}"

    # Check if registry exists
    if ! doctl registry get $APP_NAME &> /dev/null; then
        echo "Creating container registry..."
        doctl registry create $APP_NAME --subscription-tier basic
    fi

    # Login to registry
    doctl registry login

    echo -e "${GREEN}✅ Container registry ready${NC}"
}

# Function to build and push Docker image
build_and_push() {
    echo -e "${YELLOW}🔨 Building and pushing Docker image...${NC}"

    local image_tag="$DOCKER_REGISTRY/$APP_NAME:$(date +%Y%m%d-%H%M%S)"
    local latest_tag="$DOCKER_REGISTRY/$APP_NAME:latest"

    echo "Building image: $image_tag"
    docker build -t $image_tag -t $latest_tag .

    echo "Pushing to registry..."
    docker push $image_tag
    docker push $latest_tag

    echo -e "${GREEN}✅ Image pushed: $latest_tag${NC}"

    # Store image tag for deployment
    echo $latest_tag > .image_tag
}

# Function to create DigitalOcean resources
create_resources() {
    echo -e "${YELLOW}🏗️  Creating DigitalOcean resources...${NC}"

    # Create VPC for better networking
    if ! doctl vpcs list | grep -q "$APP_NAME-vpc"; then
        echo "Creating VPC..."
        doctl vpcs create \
            --name "$APP_NAME-vpc" \
            --region $REGION \
            --ip-range "10.0.0.0/16"
    fi

    # Create managed Redis cluster
    if ! doctl databases list | grep -q "$APP_NAME-redis"; then
        echo "Creating Redis cluster..."
        doctl databases create $APP_NAME-redis \
            --engine redis \
            --size db-s-1vcpu-1gb \
            --region $REGION \
            --num-nodes 1

        echo "Waiting for Redis cluster to be ready..."
        doctl databases wait $APP_NAME-redis
    fi

    # Create load balancer
    if ! doctl load-balancers list | grep -q "$APP_NAME-lb"; then
        echo "Creating load balancer..."
        doctl load-balancers create \
            --name "$APP_NAME-lb" \
            --region $REGION \
            --forwarding-rules "entry_protocol:http,entry_port:80,target_protocol:http,target_port:3000,certificate_id:,tls_passthrough:false" \
            --health-check "protocol:http,port:3000,path:/health,check_interval_seconds:10,response_timeout_seconds:5,healthy_threshold:2,unhealthy_threshold:3"
    fi

    echo -e "${GREEN}✅ DigitalOcean resources created${NC}"
}

# Function to deploy to App Platform
deploy_app_platform() {
    echo -e "${YELLOW}🚀 Deploying to DigitalOcean App Platform...${NC}"

    local image_tag=$(cat .image_tag)

    # Create app spec
    cat > app.yaml << EOF
name: $APP_NAME
services:
- name: web
  image:
    registry_type: DOCR
    repository: $APP_NAME
    tag: latest
  instance_count: 2
  instance_size_slug: professional-xs
  http_port: 3000
  environment_slug: node-js
  envs:
  - key: NODE_ENV
    value: "production"
  - key: REDIS_HOST
    value: "\${redis.HOSTNAME}"
  - key: REDIS_PORT
    value: "\${redis.PORT}"
  - key: REDIS_PASSWORD
    value: "\${redis.PASSWORD}"
  health_check:
    http_path: "/health"
  routes:
  - path: "/"

databases:
- name: redis
  engine: REDIS
  production: true
  size: basic

alerts:
- rule: CPU_UTILIZATION
  disabled: false
- rule: MEM_UTILIZATION
  disabled: false
EOF

    # Deploy or update app
    if doctl apps list | grep -q $APP_NAME; then
        echo "Updating existing app..."
        APP_ID=$(doctl apps list --format ID,Spec.Name --no-header | grep $APP_NAME | cut -d' ' -f1)
        doctl apps update $APP_ID --spec app.yaml
    else
        echo "Creating new app..."
        doctl apps create --spec app.yaml
    fi

    echo -e "${GREEN}✅ App Platform deployment initiated${NC}"
}

# Function to deploy to Droplet
deploy_droplet() {
    echo -e "${YELLOW}🖥️  Deploying to DigitalOcean Droplet...${NC}"

    local droplet_name="$APP_NAME-droplet"

    # Create droplet if it doesn't exist
    if ! doctl compute droplet list | grep -q $droplet_name; then
        echo "Creating droplet..."

        # Create user data script for automated setup
        cat > user-data.sh << 'EOF'
#!/bin/bash
apt-get update
apt-get install -y docker.io docker-compose
systemctl start docker
systemctl enable docker
usermod -aG docker ubuntu

# Install doctl
cd /tmp
wget https://github.com/digitalocean/doctl/releases/download/v1.98.1/doctl-1.98.1-linux-amd64.tar.gz
tar xf doctl-1.98.1-linux-amd64.tar.gz
mv doctl /usr/local/bin
EOF

        doctl compute droplet create $droplet_name \
            --size $DROPLET_SIZE \
            --image ubuntu-22-04-x64 \
            --region $REGION \
            --ssh-keys $(doctl compute ssh-key list --format ID --no-header | head -1) \
            --user-data-file user-data.sh \
            --wait
    fi

    # Get droplet IP
    local droplet_ip=$(doctl compute droplet list --format Name,PublicIPv4 --no-header | grep $droplet_name | awk '{print $2}')

    echo "Droplet IP: $droplet_ip"

    # Deploy via SSH
    echo "Deploying application to droplet..."

    # Copy deployment files
    scp -o StrictHostKeyChecking=no docker-compose.yml ubuntu@$droplet_ip:~/
    scp -o StrictHostKeyChecking=no .env ubuntu@$droplet_ip:~/

    # Execute deployment commands
    ssh -o StrictHostKeyChecking=no ubuntu@$droplet_ip << EOF
# Login to registry
echo $DIGITALOCEAN_ACCESS_TOKEN | docker login registry.digitalocean.com -u \$DIGITALOCEAN_ACCESS_TOKEN --password-stdin

# Pull and run
docker-compose pull
docker-compose up -d

# Setup nginx reverse proxy
sudo apt-get update
sudo apt-get install -y nginx

# Basic nginx config
sudo tee /etc/nginx/sites-available/default > /dev/null << 'NGINX_EOF'
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /health {
        proxy_pass http://localhost:3000/health;
        access_log off;
    }
}
NGINX_EOF

sudo systemctl restart nginx
sudo systemctl enable nginx
EOF

    echo -e "${GREEN}✅ Deployment to droplet completed${NC}"
    echo -e "${GREEN}🌐 Application available at: http://$droplet_ip${NC}"
}

# Function to setup monitoring
setup_monitoring() {
    echo -e "${YELLOW}📊 Setting up monitoring...${NC}"

    # Create monitoring alert policy
    doctl monitoring alert-policy create \
        --type v1/insights/droplet/cpu \
        --description "High CPU usage alert for $APP_NAME" \
        --compare GreaterThan \
        --value 80 \
        --window 5m \
        --entities $(doctl compute droplet list --format ID --no-header | grep $APP_NAME | head -1) \
        --tags "$APP_NAME,production" || true

    doctl monitoring alert-policy create \
        --type v1/insights/droplet/memory_utilization_percent \
        --description "High memory usage alert for $APP_NAME" \
        --compare GreaterThan \
        --value 85 \
        --window 5m \
        --entities $(doctl compute droplet list --format ID --no-header | grep $APP_NAME | head -1) \
        --tags "$APP_NAME,production" || true

    echo -e "${GREEN}✅ Monitoring setup completed${NC}"
}

# Main deployment function
main() {
    echo "Select deployment target:"
    echo "1) DigitalOcean App Platform (Recommended)"
    echo "2) DigitalOcean Droplet"
    echo "3) Both"

    read -p "Enter your choice (1-3): " choice

    case $choice in
        1)
            check_requirements
            authenticate_do
            setup_registry
            build_and_push
            deploy_app_platform
            ;;
        2)
            check_requirements
            authenticate_do
            setup_registry
            build_and_push
            create_resources
            deploy_droplet
            setup_monitoring
            ;;
        3)
            check_requirements
            authenticate_do
            setup_registry
            build_and_push
            create_resources
            deploy_app_platform
            deploy_droplet
            setup_monitoring
            ;;
        *)
            echo -e "${RED}❌ Invalid choice${NC}"
            exit 1
            ;;
    esac

    echo -e "${GREEN}🎉 Deployment completed successfully!${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Configure your Slack app webhook URLs"
    echo "2. Set up your LLM API keys"
    echo "3. Test the deployment with /ai commands"
    echo "4. Monitor logs and metrics"
    echo ""
    echo "Useful commands:"
    echo "- Check app status: doctl apps list"
    echo "- View logs: doctl apps logs <app-id>"
    echo "- Scale app: doctl apps update <app-id> --spec app.yaml"
}

# Run main function
main "$@"