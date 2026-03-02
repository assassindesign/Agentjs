const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const scoreDisplay = document.getElementById('score');
const highScoreDisplay = document.getElementById('high-score');
const startBtn = document.getElementById('start-btn');
const resetBtn = document.getElementById('reset-btn');

// 游戏设置
const gridSize = 20;
const tileCount = canvas.width / gridSize;

// 游戏状态
let snake = [];
let food = {};
let dx = 0;
let dy = 0;
let score = 0;
let highScore = localStorage.getItem('snakeHighScore') || 0;
let gameRunning = false;
let gameSpeed = 100; // 毫秒

// 初始化游戏
function initGame() {
    // 初始化蛇
    snake = [
        {x: 10, y: 10},
        {x: 9, y: 10},
        {x: 8, y: 10}
    ];

    // 初始化食物
    generateFood();

    // 重置方向
    dx = 1;
    dy = 0;

    // 重置分数
    score = 0;
    updateScore();

    // 更新最高分显示
    highScoreDisplay.textContent = highScore;
}

// 生成食物
function generateFood() {
    food = {
        x: Math.floor(Math.random() * tileCount),
        y: Math.floor(Math.random() * tileCount)
    };

    // 确保食物不会生成在蛇身上
    for (let segment of snake) {
        if (segment.x === food.x && segment.y === food.y) {
            generateFood();
            return;
        }
    }
}

// 更新分数显示
function updateScore() {
    scoreDisplay.textContent = score;
}

// 游戏主循环
function gameLoop() {
    if (!gameRunning) return;

    setTimeout(() => {
        moveSnake();
        checkCollision();
        drawGame();
        gameLoop();
    }, gameSpeed);
}

// 移动蛇
function moveSnake() {
    // 创建新的头部
    const head = {x: snake[0].x + dx, y: snake[0].y + dy};

    // 将新头部添加到蛇的前面
    snake.unshift(head);

    // 检查是否吃到食物
    if (head.x === food.x && head.y === food.y) {
        // 增加分数
        score += 10;
        updateScore();
        
        // 生成新食物
        generateFood();
        
        // 增加游戏速度（但不超过最大速度）
        if (gameSpeed > 50) {
            gameSpeed -= 2;
        }
    } else {
        // 如果没有吃到食物，移除蛇尾
        snake.pop();
    }
}

// 检查碰撞
function checkCollision() {
    const head = snake[0];

    // 检查是否撞墙
    if (head.x < 0 || head.x >= tileCount || head.y < 0 || head.y >= tileCount) {
        gameOver();
        return;
    }

    // 检查是否撞到自己
    for (let i = 1; i < snake.length; i++) {
        if (head.x === snake[i].x && head.y === snake[i].y) {
            gameOver();
            return;
        }
    }
}

// 游戏结束
function gameOver() {
    gameRunning = false;
    
    // 更新最高分
    if (score > highScore) {
        highScore = score;
        localStorage.setItem('snakeHighScore', highScore);
        highScoreDisplay.textContent = highScore;
    }

    // 显示游戏结束信息
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.font = '30px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('游戏结束!', canvas.width/2, canvas.height/2);
}

// 绘制游戏
function drawGame() {
    // 清空画布
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 绘制蛇
    snake.forEach((segment, index) => {
        if (index === 0) {
            // 蛇头
            ctx.fillStyle = '#2E8B57';
        } else {
            // 蛇身
            ctx.fillStyle = '#3CB371';
        }
        ctx.fillRect(segment.x * gridSize, segment.y * gridSize, gridSize - 1, gridSize - 1);
    });

    // 绘制食物
    ctx.fillStyle = '#FF4500';
    ctx.fillRect(food.x * gridSize, food.y * gridSize, gridSize - 1, gridSize - 1);
}

// 键盘控制
function controlSnake(e) {
    // 防止蛇反向移动
    switch(e.key) {
        case 'ArrowUp':
            if (dy === 0) {
                dx = 0;
                dy = -1;
            }
            break;
        case 'ArrowDown':
            if (dy === 0) {
                dx = 0;
                dy = 1;
            }
            break;
        case 'ArrowLeft':
            if (dx === 0) {
                dx = -1;
                dy = 0;
            }
            break;
        case 'ArrowRight':
            if (dx === 0) {
                dx = 1;
                dy = 0;
            }
            break;
    }
}

// 开始游戏
function startGame() {
    if (!gameRunning) {
        gameRunning = true;
        gameLoop();
    }
}

// 重置游戏
function resetGame() {
    gameRunning = false;
    initGame();
    drawGame();
}

// 事件监听器
startBtn.addEventListener('click', startGame);
resetBtn.addEventListener('click', resetGame);
document.addEventListener('keydown', controlSnake);

// 初始化游戏
initGame();
drawGame();