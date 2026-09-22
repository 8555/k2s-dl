# Use an official Node.js runtime as a parent image
FROM node:latest

# Specify a default timezone
ENV TZ=Europe/Berlin

# Set the working directory in the container
WORKDIR /app

# Copy package definition files and install dependencies
COPY package.json package-lock.json index.js ./
RUN npm i

# Make the script executable
RUN chmod +x ./index.js

# Set the entrypoint for the container
ENTRYPOINT ["node", "index.js"]
