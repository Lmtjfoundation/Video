#include "SHFx.h"
#include "SHGameMode.h"
#include "Components/PointLightComponent.h"
#include "Engine/World.h"
#include "CollisionQueryParams.h"

ASHProp::ASHProp()
{
	PrimaryActorTick.bCanEverTick = true;
	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	SetRootComponent(Root);
}

void ASHProp::AddLight(const FLinearColor& Color, float Intensity, float Radius)
{
	Light = NewObject<UPointLightComponent>(this);
	Light->SetupAttachment(Root);
	Light->SetLightColor(Color);
	Light->SetIntensity(Intensity);
	Light->SetAttenuationRadius(Radius);
	Light->SetCastShadows(false);
	Light->RegisterComponent();
	AddInstanceComponent(Light);
	LightPeak = Intensity;
}

void ASHProp::Tick(float Dt)
{
	Super::Tick(Dt);
	Age += Dt;
	if (Spin != 0.f) AddActorLocalRotation(FRotator(0.f, Spin * Dt, 0.f));
	if (BobHeight > 0.f) SetActorLocation(BaseLocation + FVector(0.f, 0.f, FMath::Sin(Age * 3.f) * BobHeight));
	if (Grow != 0.f) SetActorScale3D(GetActorScale3D() + FVector(Grow * Dt));
	if (Life > 0.f)
	{
		const float K = FMath::Clamp(1.f - Age / Life, 0.f, 1.f);
		if (Light) Light->SetIntensity(LightPeak * K);
		if (Age >= Life) Destroy();
	}
}

ASHRocket::ASHRocket()
{
	PrimaryActorTick.bCanEverTick = true;
	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	SetRootComponent(Root);
}

void ASHRocket::Tick(float Dt)
{
	Super::Tick(Dt);
	ASHGameMode* GM = ASHGameMode::Get(this);
	if (!GM) { Destroy(); return; }
	Age += Dt;
	Velocity.Z -= Gravity * Dt;
	const FVector From = GetActorLocation();
	const FVector To = From + Velocity * Dt;
	FHitResult Hit;
	FCollisionQueryParams Params(SCENE_QUERY_STAT(SHRocket), false, this);
	if (Shooter.IsValid()) Params.AddIgnoredActor(Shooter.Get());
	FCollisionObjectQueryParams Obj;
	Obj.AddObjectTypesToQuery(ECC_WorldStatic);
	Obj.AddObjectTypesToQuery(ECC_WorldDynamic);
	Obj.AddObjectTypesToQuery(ECC_Pawn);
	Obj.AddObjectTypesToQuery(ECC_Vehicle);
	const bool bHit = GetWorld()->LineTraceSingleByObjectType(Hit, From, To, Obj, Params);
	SetActorLocation(bHit ? Hit.ImpactPoint : To);
	SetActorRotation(Velocity.Rotation());
	TrailTimer -= Dt;
	if (TrailTimer <= 0.f)
	{
		TrailTimer = 0.03f;
		GM->SpawnPuff(From, FLinearColor(0.7f, 0.7f, 0.7f), 0.6f, 1.2f);
	}
	if (bHit || Age > 6.f)
	{
		GM->Explode(GetActorLocation(), RadiusM, bByPlayer, nullptr);
		Destroy();
	}
}
