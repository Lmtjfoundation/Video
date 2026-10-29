// The player on foot: third-person movement, weapons, carjacking, swimming and parachuting.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "SHTypes.h"
#include "SHHuman.h"
#include "SHPlayerCharacter.generated.h"

class USpringArmComponent;
class UCameraComponent;

UCLASS()
class SOUTHERNHEAT_API ASHPlayerCharacter : public ACharacter
{
	GENERATED_BODY()

public:
	ASHPlayerCharacter();
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;
	virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;
	virtual void Landed(const FHitResult& Hit) override;

	UPROPERTY(VisibleAnywhere) TObjectPtr<USpringArmComponent> Arm;
	UPROPERTY(VisibleAnywhere) TObjectPtr<UCameraComponent> Camera;
	UPROPERTY() TObjectPtr<USceneComponent> Chute;

	FSHHumanRig Rig;
	float Health = 100.f;
	float Armor = 0.f;
	ESHWeapon Weapon = ESHWeapon::Pistol;
	int32 Ammo[(int32)ESHWeapon::Count] = { 1, 90, 0, 0, 0, 0 };
	bool bAiming = false, bSprinting = false, bFireHeld = false, bSwimming = false, bChuteOpen = false;
	float Cooldown = 0.f, PunchT = 0.f, LastShot = -10.f;
	bool bRigBuilt = false;

	void GiveWeapon(ESHWeapon W, int32 Count = -1);
	void CycleWeapon(int32 Dir);
	// Fires the current weapon from Muzzle toward Aim. Used on foot and for drive-bys.
	void FireWeapon(const FVector& Muzzle, const FVector& Aim, AActor* IgnoreActor);
	void TakeHit(float Damage, bool bFall = false);
	void SetHiddenForVehicle(bool bHide);
	void OpenChute();
	void CloseChute();

private:
	void MoveForward(float V);
	void MoveRight(float V);
	void Turn(float V) { AddControllerYawInput(V); }
	void LookUp(float V) { AddControllerPitchInput(V); }
	void JumpPressed();
	void SprintOn() { bSprinting = true; }
	void SprintOff() { bSprinting = false; }
	void FireOn() { bFireHeld = true; TryFire(true); }
	void FireOff() { bFireHeld = false; }
	void AimOn() { bAiming = true; }
	void AimOff() { bAiming = false; }
	void EnterPressed();
	void NextWeapon() { CycleWeapon(1); }
	void PrevWeapon() { CycleWeapon(-1); }
	void TryFire(bool bPressed);
	void Punch();
	float FallStartZ = 0.f;
};
