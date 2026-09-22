# About
A self-contained toolkit for automated batch downloads from keep2share.cc, consisting of a downloader script and a captcha solver,
both written in JavaScript for Node.js. This script offers the following advantages over JDownloader or other tools in order to
maximize the throughput as a free user:
 - Parallel downloads via both IPv4 and IPv6
 - Starting the next download as soon as possible, instead of waiting for the previous download to finish

The project is meant to be run inside Docker containers, but you can also run these scripts directly via Node.js or any other JavaScript runtime.

# Setup
1. Clone this repository into the current directory: `git clone https://github.com/8555/k2s-dl.git .`
2. Paste your links into a text file, one per line
3. Adjust the paths in `docker-compose.yml` to point to the file containing the links and whichever directory you want the downloads to be saved to
4. Build and start the containers: `sudo docker compose up -d --build`
5. Monitor the progress using `sudo docker compose logs -f`

# Notes
Files that already exist in the output path get overwritten, unless the size is the same.

Credits to [cracker0dks](https://github.com/cracker0dks/CaptchaSolver) for the captcha solver.
