// Import dependencies
const path = require('path');
const http = require('http');
const express = require('express');
const socketIO = require('socket.io');
const { MongoClient } = require('mongodb');

// Import classes
const { LiveGames } = require('./utils/liveGames');
const { Players } = require('./utils/players');

// MongoDB connection setup
const url = "mongodb+srv://nsepar1:LenovO2004@cluster0.nxpwb.mongodb.net/kahootDB?retryWrites=true&w=majority";
let db, gamesCollection;

// Connect to MongoDB and initialize the collection
// Delay starting socket events until the database connection is established
MongoClient.connect(url, { useUnifiedTopology: true })
    .then((client) => {
        console.log('Connected to MongoDB online!');
        db = client.db('kahootDB');
        gamesCollection = db.collection('kahootGames');
        startSocketEvents(); // Call this function to handle socket events
    })
    .catch((err) => {
        console.error('Failed to connect to MongoDB:', err);
        process.exit(1); // Exit the process if the database connection fails
});


// Express and socket.io setup
const publicPath = path.join(__dirname, '../public');
const app = express();
const server = http.createServer(app);
const io = socketIO(server);
//const socket = io('http://localhost:3000'); // Ensure it connects to the correct server


const games = new LiveGames();
const players = new Players();

app.use(express.static(publicPath));

// Starting server on port 3000
server.listen(3000, () => {
    console.log('Server started on port 3000');
});

// When a connection to server is made from client
function startSocketEvents() {
    io.on('connection', (socket) => {
        console.log('New client connected:', socket.id);

        // Host joins a game
        socket.on('host-join', async (data) => {
            try {
                const kahootGame = await gamesCollection.findOne({ id: parseInt(data.id) });

                if (kahootGame) {
                    const gamePin = Math.floor(Math.random() * 90000) + 10000;
                    games.addGame(gamePin, socket.id, false, {
                        playersAnswered: 0,
                        questionLive: false,
                        gameid: data.id,
                        question: 1,
                    });

                    socket.join(gamePin);
                    socket.emit('showGamePin', { pin: gamePin });

                    console.log('Game Created with PIN:', gamePin);
                } else {
                    socket.emit('noGameFound');
                }
            } catch (err) {
                console.error('Error fetching game:', err);
            }
        });

        // Player joins a game
        socket.on('player-join', (params) => {
            let gameFound = false;
        
            for (let i = 0; i < games.games.length; i++) {
                if (params.pin == games.games[i].pin) {
                    const hostId = games.games[i].hostId;
        
                    players.addPlayer(hostId, socket.id, params.name, { score: 0, answer: 0 });
                    socket.join(params.pin); // Add the player to the game room
        
                    const playersInGame = players.getPlayers(hostId);
                    io.to(hostId).emit('updatePlayerLobby', playersInGame);
        
                    console.log(`Player ${params.name} joined game with PIN: ${params.pin}`);
                    gameFound = true;
                    break;
                }
            }
        
            if (!gameFound) {
                socket.emit('noGameFound');
            }
        });
        

        // Host starts the game
        socket.on('startGame', async () => {
            const game = games.getGame(socket.id);
        
            if (game) {
                if (game.gameLive) {
                    console.log(`Game with PIN ${game.pin} has already started.`);
                    return;
                }
        
                game.gameLive = true;
        
                // Debug log to check players in the room
                const socketsInRoom = await io.in(game.pin).fetchSockets();
                console.log(`Players in room ${game.pin}:`, socketsInRoom.map((s) => s.id));
        
                // Broadcast event to players
                io.to(game.pin).emit('gameStartedPlayer');
                console.log(`Broadcasted 'gameStartedPlayer' event to room ${game.pin}`);
        
                // Emit event specifically for the host
                socket.emit('gameStarted');
                console.log(`Game with PIN ${game.pin} started.`);
            } else {
                console.error("Error: Game not found for host", socket.id);
                socket.emit('errorMessage', { message: "Game not found. Unable to start." });
            }
        });
        
     // Disconnect logic
     socket.on('disconnect', () => {
        const game = games.getGame(socket.id);

        if (game) {
            games.removeGame(socket.id);
            const playersInGame = players.getPlayers(socket.id);

            playersInGame.forEach((player) => players.removePlayer(player.playerId));
            io.to(game.pin).emit('hostDisconnect');

            console.log(`Game with PIN ${game.pin} ended.`);
        } else {
            const player = players.getPlayer(socket.id);

            if (player) {
                players.removePlayer(socket.id);
                const playersInGame = players.getPlayers(player.hostId);
                io.to(player.hostId).emit('updatePlayerLobby', playersInGame);

                console.log(`Player disconnected: ${player.playerId}`);
            }
        }
    });
    
    socket.on('playerAnswer', (num) => {
        const player = players.getPlayer(socket.id);
        if (player) {
            const hostId = player.hostId;
            const game = games.getGame(hostId);
    
            if (game && game.gameData.questionLive) {
                player.gameData.answer = num; // Record player's answer
                game.gameData.playersAnswered++;
    
                console.log(`Player ${player.playerId} answered: ${num}`);
                console.log(`Players answered: ${game.gameData.playersAnswered}/${players.getPlayers(hostId).length}`);
    
                // If all players answered
                if (game.gameData.playersAnswered === players.getPlayers(hostId).length) {
                    game.gameData.questionLive = false;
                    io.to(game.pin).emit('questionOver', {
                        correctAnswer: game.correctAnswer,
                        players: players.getPlayers(hostId),
                    });
                    console.log("All players answered. Broadcasting questionOver.");
                }
            }
        }
    });
    

    // Request DB names
    socket.on('requestDbNames', async () => {
        try {
            const games = await gamesCollection.find().toArray();
            socket.emit('gameNamesData', games);
        } catch (err) {
            console.error('Error fetching game names:', err);
        }
    });

    // When a new quiz is created
    socket.on('newQuiz', async (data) => {
        try {
            const lastGame = await gamesCollection.find().sort({ id: -1 }).limit(1).toArray();
            data.id = lastGame.length ? lastGame[0].id + 1 : 1;

            await gamesCollection.insertOne(data);

            console.log('New quiz added:', data.name);
            socket.emit('startGameFromCreator', data.id);
        } catch (err) {
            console.error('Error creating quiz:', err);
        }
    });

    
    
    });
}