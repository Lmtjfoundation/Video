// Small runtime actors: timed effects (explosion flashes, tracers, blood),
// spinning props (pickups, mission markers) and rockets.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "SHFx.generated.h"

class UPointLightComponent;

UCLASS()
class SOUTHERNHEAT_API ASHProp : public AActor
{
	GENERATED_BODY()

public:
	ASHProp();
	virtual void Tick(float DeltaSeconds) override;

	UPROPERTY() TObjectPtr<USceneComponent> Root;
	UPROPERTY() TObjectPtr<UPointLightComponent> Light;

	float Spin = 0.f;          // degrees per second
	float Life = -1.f;         // seconds, <0 = forever
	float Grow = 0.f;          // uniform scale growth per second
	float LightPeak = 0.f;
	float BobHeight = 0.f;
	float Age = 0.f;
	FVector BaseLocation;
	void AddLight(const FLinearColor& Color, float Intensity, float Radius);
};

UCLASS()
class SOUTHERNHEAT_API ASHRocket : public AActor
{
	GENERATED_BODY()

public:
	ASHRocket();
	virtual void Tick(float DeltaSeconds) override;

	UPROPERTY() TObjectPtr<USceneComponent> Root;
	FVector Velocity;
	TWeakObjectPtr<AActor> Shooter;
	bool bByPlayer = false;
	float RadiusM = 9.f;
	float Age = 0.f;
	float Gravity = 0.f;
	float TrailTimer = 0.f;
};
