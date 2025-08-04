    const http = require('http');
    const fs = require('fs');
    const path = require('path');

    const PORT = 8000; // You can choose any available port

    const server = http.createServer((req, res) => {
        // Serve index.html for all requests
        const filePath = path.join(__dirname, 'public/index.html');

        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Error loading index.html');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
    });

    server.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}/`);
    });