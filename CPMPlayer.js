/**
 * Just some side notes here.
 *
 * - Should keep in mind that idTech's cartisian plane is different to Unity's:
 *    Z axis in idTech is "up/down" but in Unity Z is the local equivalent to
 *    "forward/backward" and Y in Unity is considered "up/down".
 *
 * - Code's mostly ported on a 1 to 1 basis, so some naming convensions are a
 *   bit fucked up right now.
 *
 * - UPS is measured in Unity units, the idTech units DO NOT scale right now.
 *
 * - Default values are accurate and emulates Quake 3's feel with CPM(A) physics.
 */

#pragma strict

/* Player view stuff */
var playerView : Transform;  // Must be a camera
var playerViewYOffset = 0.6; // The height at which the camera is bound to
var xMouseSensitivity = 30.0;
var yMouseSensitivity = 30.0;

/* Frame occuring factors */
var gravity  : float = 20.0;
var friction : float = 6;                // Ground friction

/* Movement stuff */
var moveSpeed              : float = 7.0;  // Ground move speed
var runAcceleration        : float = 14;   // Ground accel
var runDeacceleration      : float = 10;   // Deacceleration that occurs when running on the ground
var airAcceleration        : float = 2.0;  // Air accel
var airDeacceleration      : float = 2.0;    // Deacceleration experienced when opposite strafing
var airControl             : float = 0.3;  // How precise air control is
var sideStrafeAcceleration : float = 50;   // How fast acceleration occurs to get up to sideStrafeSpeed when side strafing
var sideStrafeSpeed        : float = 1;    // What the max speed to generate when side strafing
var jumpSpeed              : float = 8.0;  // The speed at which the character's up axis gains when hitting jump
var holdJumpToBhop         : boolean = false; // When enabled allows player to just hold jump button to keep on bhopping perfectly. Beware: smells like casual.

/* print() styles */
var style : GUIStyle;

/* FPS Stuff */
var fpsDisplayRate = 4.0;  // 4 updates per sec.




private var frameCount = 0;
private var dt = 0.0;
private var fps = 0.0;

private var controller : CharacterController;

// Camera rotationals
private var rotX = 0.0;
private var rotY = 0.0;

private var moveDirection : Vector3 = Vector3.zero;
private var moveDirectionNorm : Vector3 = Vector3.zero;
private var playerVelocity : Vector3 = Vector3.zero;
private var playerTopVelocity : float = 0.0;

// If true then the player is fully on the ground
private var grounded = false;

// Q3: players can queue the next jump just before he hits the ground
private var wishJump = false;

// Used to display real time friction values
private var playerFriction : float = 0.0;

// Contains the command the user wishes upon the character
class Cmd {
	public var forwardmove: float;
	public var rightmove: float;
	public var upmove: float;
}
private var cmd : Cmd; // Player commands, stores wish commands that the player asks for (Forward, back, jump, etc)

/* Player statuses */
private var isDead = false;

private var playerSpawnPos : Vector3;
private var playerSpawnRot : Quaternion;

function Start()
{
	/* Hide the cursor */
	Cursor.visible = false;
    Cursor.lockState = CursorLockMode.Locked;

	/* Put the camera inside the capsule collider */
	playerView.position = this.transform.position;
	playerView.position.y = this.transform.position.y + playerViewYOffset;

	controller = GetComponent(CharacterController);
	cmd = new Cmd();

	// Set the spawn position of the player
	playerSpawnPos = transform.position;
	playerSpawnRot = this.playerView.rotation;
}

function Update()
{
	/* Do FPS calculation */
	frameCount++;
	dt += Time.deltaTime;
	if(dt > 1.0/fpsDisplayRate)
	{
		fps = Mathf.Round(frameCount / dt);
		frameCount = 0;
		dt -= 1.0/fpsDisplayRate;
	}

	/* Ensure that the cursor is locked into the screen */
	if(Cursor.lockState != CursorLockMode.Locked)
	{
		if(Input.GetMouseButtonDown(0))
            Cursor.lockState = CursorLockMode.Locked;
	}

	/* Camera rotation stuff, mouse controls this shit */
	rotX -= Input.GetAxis("Mouse Y") * xMouseSensitivity * 0.02;
	rotY += Input.GetAxis("Mouse X") * yMouseSensitivity * 0.02;

	// Clamp the X rotation
	if(rotX < -90)
		rotX = -90;
	else if(rotX > 90)
		rotX = 90;

	this.transform.rotation = Quaternion.Euler(0, rotY, 0); // Rotates the collider
	playerView.rotation     = Quaternion.Euler(rotX, rotY, 0); // Rotates the camera

	/* Movement, here's the important part */
	QueueJump();
	if(controller.isGrounded)
		GroundMove();
	else if(!controller.isGrounded)
		AirMove();

	// Move the controller
	controller.Move(playerVelocity * Time.deltaTime);

    //Need to move the camera after the player has been moved because otherwise the camera will clip the player if going fast enough and will always be 1 frame behind.
    // Set the camera's position to the transform
	playerView.position = this.transform.position;
	playerView.position.y = this.transform.position.y + playerViewYOffset;

	/* Calculate top velocity */
	var udp = playerVelocity;
	udp.y = 0.0;
	if(udp.magnitude > playerTopVelocity)
		playerTopVelocity = udp.magnitude;

	if(Input.GetKeyUp('x'))
		PlayerExplode();
	if(Input.GetAxis("Fire1") && isDead)
		PlayerSpawn();
}


/*******************************************************************************************************\
|* MOVEMENT
\*******************************************************************************************************/

/**
 * Sets the movement direction based on player input
 */
function SetMovementDir()
{
	cmd.forwardmove = Input.GetAxis("Vertical");
	cmd.rightmove   = Input.GetAxis("Horizontal");
}

/**
 * Queues the next jump just like in Q3
 */
function QueueJump()
{
    if(holdJumpToBhop) {
        wishJump = Input.GetKey(KeyCode.Space);
        return;
    }

	if(Input.GetKeyDown(KeyCode.Space) && !wishJump)
		wishJump = true;
	if(Input.GetKeyUp(KeyCode.Space))
		wishJump = false;
}

/**
 * Execs when the player is in the air
 */
function AirMove()
{
	var wishdir : Vector3;
	var wishvel : float = airAcceleration;
	var accel : float;

	SetMovementDir();
	
	wishdir = Vector3(cmd.rightmove, 0, cmd.forwardmove);
	wishdir = transform.TransformDirection(wishdir);

	var wishspeed = wishdir.magnitude;
	wishspeed *= moveSpeed;
	
	wishdir.Normalize();
	moveDirectionNorm = wishdir;

	// CPM: Aircontrol
	var wishspeed2 = wishspeed;
	if(Vector3.Dot(playerVelocity, wishdir) < 0)
		accel = airDeacceleration;
	else
		accel = airAcceleration;
	// If the player is ONLY strafing left or right
	if(cmd.forwardmove == 0 && cmd.rightmove != 0)
	{
		if(wishspeed > sideStrafeSpeed)
			wishspeed = sideStrafeSpeed;
		accel = sideStrafeAcceleration;
	}

	Accelerate(wishdir, wishspeed, accel);
	if(airControl)
		AirControl(wishdir, wishspeed2);
	// !CPM: Aircontrol

	// Apply gravity
	playerVelocity.y -= gravity * Time.deltaTime;

	// LEGACY MOVEMENT SEE BOTTOM
}

/**
 * Air control occurs when the player is in the air, it allows
 * players to move side to side much faster rather than being
 * 'sluggish' when it comes to cornering.
 */
function AirControl(wishdir : Vector3, wishspeed : float)
{
	var zspeed : float;
	var speed  : float;
	var dot    : float;
	var k      : float;
	var i      : int;

	// Can't control movement if not moving forward or backward
	if(cmd.forwardmove == 0 || wishspeed == 0)
		return;

	zspeed = playerVelocity.y;
	playerVelocity.y = 0;
	/* Next two lines are equivalent to idTech's VectorNormalize() */
	speed = playerVelocity.magnitude;
	playerVelocity.Normalize();

	dot = Vector3.Dot(playerVelocity, wishdir);
	k = 32;
	k *= airControl * dot * dot * Time.deltaTime;

	// Change direction while slowing down
	if(dot > 0)
	{
		playerVelocity.x = playerVelocity.x * speed + wishdir.x * k;
		playerVelocity.y = playerVelocity.y * speed + wishdir.y * k;
		playerVelocity.z = playerVelocity.z * speed + wishdir.z * k;

		playerVelocity.Normalize();
		moveDirectionNorm = playerVelocity;
	}

	playerVelocity.x *= speed;
	playerVelocity.y = zspeed; // Note this line
	playerVelocity.z *= speed;

}

/**
 * Called every frame when the engine detects that the player is on the ground
 */
function GroundMove()
{
	var wishdir : Vector3;
	var wishvel : Vector3;

	// Do not apply friction if the player is queueing up the next jump
	if(!wishJump)
		ApplyFriction(1.0);
	else
		ApplyFriction(0);

	SetMovementDir();

	wishdir = Vector3(cmd.rightmove, 0, cmd.forwardmove);
	wishdir = transform.TransformDirection(wishdir);
	wishdir.Normalize();
	moveDirectionNorm = wishdir;

	var wishspeed = wishdir.magnitude;
	wishspeed *= moveSpeed;

	Accelerate(wishdir, wishspeed, runAcceleration);

	// Reset the gravity velocity
	playerVelocity.y = 0;
	
	if(wishJump)
	{
		playerVelocity.y = jumpSpeed;
		wishJump = false;
	}
}

/**
 * Applies friction to the player, called in both the air and on the ground
 */
function ApplyFriction(t : float)
{
	var vec : Vector3 = playerVelocity; // Equivalent to: VectorCopy();
	var vel : float;
	var speed : float;
	var newspeed : float;
	var control : float;
	var drop : float;

	vec.y = 0.0;
	speed = vec.magnitude;
	drop = 0.0;

	/* Only if the player is on the ground then apply friction */
	if(controller.isGrounded)
	{
		control = speed < runDeacceleration ? runDeacceleration : speed;
		drop = control * friction * Time.deltaTime * t;
	}

	newspeed = speed - drop;
	playerFriction = newspeed;
	if(newspeed < 0)
		newspeed = 0;
	if(speed > 0)
		newspeed /= speed;

	playerVelocity.x *= newspeed;
	// playerVelocity.y *= newspeed;
	playerVelocity.z *= newspeed;
}

/**
 * Calculates wish acceleration based on player's cmd wishes
 */
function Accelerate(wishdir : Vector3, wishspeed : float, accel : float)
{
	var addspeed : float;
	var accelspeed : float;
	var currentspeed : float;

	currentspeed = Vector3.Dot(playerVelocity, wishdir);
	addspeed = wishspeed - currentspeed;
	if(addspeed <= 0)
		return;
	accelspeed = accel * Time.deltaTime * wishspeed;
	if(accelspeed > addspeed)
		accelspeed = addspeed;

	playerVelocity.x += accelspeed * wishdir.x;
	playerVelocity.z += accelspeed * wishdir.z;
}




function LateUpdate()
{
	
}

function OnGUI()
{
	GUI.Label(Rect(0, 0, 400, 100), "FPS: " + fps, style);
	var ups = controller.velocity;
	ups.y = 0;
	GUI.Label(Rect(0, 15, 400, 100), "Speed: " + Mathf.Round(ups.magnitude * 100) / 100 + "ups", style);
	GUI.Label(Rect(0, 30, 400, 100), "Top Speed: " + Mathf.Round(playerTopVelocity * 100) / 100 + "ups", style);
}


function PlayerExplode()
{
	//var velocity = controller.velocity;
	//velocity.Normalize();
	//var gibEffect = Instantiate(gibEffectPrefab, transform.position, Quaternion.identity);
	//gibEffect.GetComponent(GibFX).Explode(transform.position, velocity, controller.velocity.magnitude);
	isDead = true;
}

function PlayerSpawn()
{
	this.transform.position = playerSpawnPos;
	this.playerView.rotation = playerSpawnRot;
	rotX = 0.0;
	rotY = 0.0;
	playerVelocity = Vector3.zero;
	isDead = false;
}


	// Legacy movement

	// var wishdir : Vector3;
	// var wishvel : float = airAcceleration;

	// // var scale = CmdScale();

	// SetMovementDir();

	// /* If the player is just strafing in the air 
	//    this simulates CPM (Not very accurately by
	//    itself) */
	// if(cmd.forwardmove == 0 && cmd.rightmove != 0)
	// {
	// 	wishvel = airStrafeAcceleration;
	// }

	// wishdir = Vector3(cmd.rightmove, 0, cmd.forwardmove);
	// wishdir = transform.TransformDirection(wishdir);
	// wishdir.Normalize();
	// moveDirectionNorm = wishdir;

	// var wishspeed = wishdir.magnitude;
	// wishspeed *= moveSpeed;

	// Accelerate(wishdir, wishspeed, wishvel);

	// // Apply gravity
	// playerVelocity.y -= gravity * Time.deltaTime;
