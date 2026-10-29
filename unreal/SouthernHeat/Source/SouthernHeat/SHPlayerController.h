// Player controller: map toggle, GPS waypoint clicks and console cheats.
// Open the console with ~ and type e.g.  Cheat HESOYAM   (or just  HESOYAM ).
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerController.h"
#include "SHPlayerController.generated.h"

UCLASS()
class SOUTHERNHEAT_API ASHPlayerController : public APlayerController
{
	GENERATED_BODY()

public:
	virtual void BeginPlay() override;
	virtual void SetupInputComponent() override;
	virtual void PlayerTick(float DeltaTime) override;

	UFUNCTION(Exec) void Cheat(const FString& Code);
	UFUNCTION(Exec) void HESOYAM();
	UFUNCTION(Exec) void TOOLUP();
	UFUNCTION(Exec) void PAINKILLER();
	UFUNCTION(Exec) void LAWYERUP();
	UFUNCTION(Exec) void FUGITIVE();
	UFUNCTION(Exec) void SKYFALL();
	UFUNCTION(Exec) void COMET();
	UFUNCTION(Exec) void BUZZOFF();
	UFUNCTION(Exec) void RHINO();
	UFUNCTION(Exec) void MONSTER();
	UFUNCTION(Exec) void ARMAGEDDON();

private:
	void ToggleMap();
	void ShowControls();
};
