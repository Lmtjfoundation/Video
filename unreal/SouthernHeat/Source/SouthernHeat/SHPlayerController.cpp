#include "SHPlayerController.h"
#include "SHGameMode.h"
#include "SHHUD.h"
#include "Components/InputComponent.h"
#include "InputCoreTypes.h"

void ASHPlayerController::BeginPlay()
{
	Super::BeginPlay();
	SetInputMode(FInputModeGameOnly());
	bShowMouseCursor = false;
}

void ASHPlayerController::SetupInputComponent()
{
	Super::SetupInputComponent();
	InputComponent->BindAction("Map", IE_Pressed, this, &ASHPlayerController::ToggleMap);
	InputComponent->BindAction("Help", IE_Pressed, this, &ASHPlayerController::ShowControls);
}

void ASHPlayerController::ToggleMap()
{
	ASHGameMode* GM = ASHGameMode::Get(this);
	if (!GM) return;
	GM->bMapOpen = !GM->bMapOpen;
	bShowMouseCursor = GM->bMapOpen;
	if (GM->bMapOpen)
	{
		FInputModeGameAndUI Mode;
		Mode.SetHideCursorDuringCapture(false);
		SetInputMode(Mode);
	}
	else SetInputMode(FInputModeGameOnly());
	SetIgnoreLookInput(GM->bMapOpen);
	SetIgnoreMoveInput(GM->bMapOpen);
}

void ASHPlayerController::PlayerTick(float DeltaTime)
{
	Super::PlayerTick(DeltaTime);
	ASHGameMode* GM = ASHGameMode::Get(this);
	if (!GM || !GM->bMapOpen) return;
	ASHHUD* TheHUD = Cast<ASHHUD>(GetHUD());
	float X, Y;
	if (!TheHUD || !GetMousePosition(X, Y)) return;
	if (WasInputKeyJustPressed(EKeys::LeftMouseButton))
	{
		FVector2D WorldPos;
		if (TheHUD->MapScreenToWorld(X, Y, WorldPos)) { GM->bHasWaypoint = true; GM->Waypoint = WorldPos; }
	}
	if (WasInputKeyJustPressed(EKeys::RightMouseButton)) GM->bHasWaypoint = false;
}

void ASHPlayerController::ShowControls()
{
	if (ASHGameMode* GM = ASHGameMode::Get(this))
		GM->ShowHelp(TEXT("ON FOOT: WASD move, Shift sprint, Space jump/parachute, LMB shoot, RMB aim, wheel weapons, F steal car\n")
			TEXT("DRIVING: W/S gas/brake, A/D steer, Space handbrake, Shift nitro, E siren, LMB drive-by, F exit\n")
			TEXT("HELICOPTER: Space climb, Shift descend, W/S tilt, A/D turn, LMB rockets\n")
			TEXT("M map + GPS (click to set waypoint)   ~ console: Cheat HESOYAM, TOOLUP, RHINO, BUZZOFF, SKYFALL, ARMAGEDDON..."), 12.f);
}

void ASHPlayerController::Cheat(const FString& Code) { if (ASHGameMode* GM = ASHGameMode::Get(this)) GM->ApplyCheat(Code); }
void ASHPlayerController::HESOYAM() { Cheat(TEXT("HESOYAM")); }
void ASHPlayerController::TOOLUP() { Cheat(TEXT("TOOLUP")); }
void ASHPlayerController::PAINKILLER() { Cheat(TEXT("PAINKILLER")); }
void ASHPlayerController::LAWYERUP() { Cheat(TEXT("LAWYERUP")); }
void ASHPlayerController::FUGITIVE() { Cheat(TEXT("FUGITIVE")); }
void ASHPlayerController::SKYFALL() { Cheat(TEXT("SKYFALL")); }
void ASHPlayerController::COMET() { Cheat(TEXT("COMET")); }
void ASHPlayerController::BUZZOFF() { Cheat(TEXT("BUZZOFF")); }
void ASHPlayerController::RHINO() { Cheat(TEXT("RHINO")); }
void ASHPlayerController::MONSTER() { Cheat(TEXT("MONSTER")); }
void ASHPlayerController::ARMAGEDDON() { Cheat(TEXT("ARMAGEDDON")); }
