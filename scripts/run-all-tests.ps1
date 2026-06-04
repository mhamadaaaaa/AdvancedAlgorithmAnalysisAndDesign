# Run all Artillery stress tests (requires gateway at http://localhost:9090)
Write-Host "Ensure Docker is running: docker compose up -d" -ForegroundColor Cyan
npm install
npm run test:all
Write-Host "Reports written to ./reports/" -ForegroundColor Green
