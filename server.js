const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

const publicDir = path.join(__dirname, "public");

const server = http.createServer((req, res) => {

    let filePath = req.url === "/"
        ? path.join(publicDir, "index.html")
        : path.join(publicDir, req.url);

    filePath = path.normalize(filePath);

    if (!filePath.startsWith(publicDir)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
    }

    fs.readFile(filePath, (err, data) => {

        if (err) {
            res.writeHead(404);
            res.end("Not Found");
            return;
        }

        let contentType = "text/plain";

        if (filePath.endsWith(".html")) {
            contentType = "text/html; charset=utf-8";
        }
        else if (filePath.endsWith(".ttf")) {
            contentType = "font/ttf";
        }
        else if (filePath.endsWith(".css")) {
            contentType = "text/css; charset=utf-8";
        }
        else if (filePath.endsWith(".js")) {
            contentType = "text/javascript; charset=utf-8";
        }

        res.writeHead(200, {
            "Content-Type": contentType
        });

        res.end(data);
    });
});


const wss = new WebSocket.Server({
    server
});


let waitingPlayer = null;

let rooms = new Map();

let nextRoomId = 1;


const winningLines = [

    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],

    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],

    [0, 4, 8],
    [2, 4, 6]

];


function send(ws, data) {

    if (
        ws &&
        ws.readyState === WebSocket.OPEN
    ) {
        ws.send(JSON.stringify(data));
    }
}


function checkWinner(board) {

    for (const line of winningLines) {

        const a = line[0];
        const b = line[1];
        const c = line[2];

        if (
            board[a] !== "" &&
            board[a] === board[b] &&
            board[a] === board[c]
        ) {
            return board[a];
        }
    }

    if (board.every(cell => cell !== "")) {
        return "DRAW";
    }

    return null;
}


function createRoom(playerX, playerO) {

    const room = {

        id: String(nextRoomId++),

        playerX,
        playerO,

        board: [
            "", "", "",
            "", "", "",
            "", "", ""
        ],

        turn: "X",

        finished: false

    };


    rooms.set(room.id, room);


    playerX.room = room;
    playerX.symbol = "X";

    playerO.room = room;
    playerO.symbol = "O";


    send(playerX.ws, {
        type: "matched",
        symbol: "X",
        room: room.id
    });


    send(playerO.ws, {
        type: "matched",
        symbol: "O",
        room: room.id
    });


    send(playerX.ws, {
        type: "state",
        board: room.board,
        turn: room.turn
    });


    send(playerO.ws, {
        type: "state",
        board: room.board,
        turn: room.turn
    });
}


function findMatch(player) {

    if (waitingPlayer === player) {
        return;
    }


    if (
        waitingPlayer &&
        waitingPlayer.ws.readyState === WebSocket.OPEN
    ) {

        const opponent = waitingPlayer;

        waitingPlayer = null;

        createRoom(opponent, player);

        return;
    }


    waitingPlayer = player;


    send(player.ws, {
        type: "waiting"
    });
}


function leaveRoom(player) {

    const room = player.room;

    if (!room) {
        return;
    }


    const opponent =
        room.playerX === player
            ? room.playerO
            : room.playerX;


    rooms.delete(room.id);

    player.room = null;
    player.symbol = null;


    if (opponent) {

        opponent.room = null;
        opponent.symbol = null;

        send(opponent.ws, {
            type: "opponent_left"
        });

    }
}


wss.on("connection", ws => {

    const player = {

        ws,

        room: null,

        symbol: null

    };


    send(ws, {
        type: "connected"
    });


    ws.on("message", message => {

        let data;

        try {
            data = JSON.parse(message.toString());
        }
        catch {
            return;
        }


        /*
         * 랜덤 매칭
         */

        if (data.type === "find_match") {

            if (player.room) {
                return;
            }

            findMatch(player);

            return;
        }


        /*
         * 착수
         */

        if (data.type === "move") {

            const room = player.room;

            if (!room) {
                return;
            }

            if (room.finished) {
                return;
            }


            /*
             * 자신의 차례인지 검사
             */

            if (room.turn !== player.symbol) {
                return;
            }


            const index = Number(data.index);


            /*
             * 올바른 칸인지 검사
             */

            if (
                !Number.isInteger(index) ||
                index < 0 ||
                index > 8
            ) {
                return;
            }


            /*
             * 이미 놓인 칸인지 검사
             */

            if (room.board[index] !== "") {
                return;
            }


            room.board[index] =
                player.symbol;


            const winner =
                checkWinner(room.board);


            if (winner) {

                room.finished = true;


                send(room.playerX.ws, {
                    type: "state",
                    board: room.board,
                    turn: "",
                    winner
                });


                send(room.playerO.ws, {
                    type: "state",
                    board: room.board,
                    turn: "",
                    winner
                });


                return;
            }


            room.turn =
                player.symbol === "X"
                    ? "O"
                    : "X";


            send(room.playerX.ws, {
                type: "state",
                board: room.board,
                turn: room.turn
            });


            send(room.playerO.ws, {
                type: "state",
                board: room.board,
                turn: room.turn
            });


            return;
        }


        /*
         * 다시 매칭
         */

        if (data.type === "rematch") {

            leaveRoom(player);

            findMatch(player);

            return;
        }

    });


    ws.on("close", () => {

        if (waitingPlayer === player) {
            waitingPlayer = null;
        }

        leaveRoom(player);

    });

});


server.listen(PORT, () => {

    console.log(
        `Tic-Tac-Toe server running on port ${PORT}`
    );

});