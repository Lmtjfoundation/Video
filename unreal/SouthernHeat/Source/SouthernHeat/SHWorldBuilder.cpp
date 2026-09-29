#include "SHWorldBuilder.h"
#include "SHGameMode.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/SkyAtmosphereComponent.h"
#include "Components/SkyLightComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "Components/TextRenderComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "CollisionQueryParams.h"

namespace
{
	constexpr float PITCH = 100.f;     // road centreline spacing (m)
	constexpr float ROAD_HALF = 9.f;
	constexpr float BLOCK_HALF = 41.f;
	constexpr float LOT = 37.f;
	constexpr float HWY_HALF = 15.f;
	constexpr float WORLD_MIN_X = -3300.f, WORLD_MAX_X = 3300.f, WORLD_MIN_Z = -1500.f, WORLD_MAX_Z = 2350.f;

	const TCHAR* PASTELS[] = { TEXT("FFD7E0"), TEXT("FFF1B8"), TEXT("C8F0D8"), TEXT("C8DCFF"), TEXT("FFCFA8"), TEXT("E8D0FF"), TEXT("F7F7F7") };
	const TCHAR* OFFICE[] = { TEXT("CFC8BB"), TEXT("E6DDCF"), TEXT("B8B2A8"), TEXT("D9D2C4"), TEXT("A9A49B") };
	const TCHAR* BRICK[] = { TEXT("8A4A36"), TEXT("9B5540"), TEXT("7A3F2E"), TEXT("A0644A"), TEXT("6E4436") };
	const TCHAR* GLASS[] = { TEXT("5F7F99"), TEXT("4D6A80"), TEXT("6E8FA8"), TEXT("3E5569"), TEXT("7C9CB0") };
	const TCHAR* RES[] = { TEXT("E0D4BD"), TEXT("D8C8A8"), TEXT("E8E0D0"), TEXT("C9B79C"), TEXT("DCCFB8") };

	FLinearColor PickC(FRandomStream& R, const TCHAR* const* Arr, int32 N) { return SH::Hex(Arr[R.RandRange(0, N - 1)]); }
}

ASHWorldBuilder::ASHWorldBuilder()
{
	PrimaryActorTick.bCanEverTick = true;
	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	SetRootComponent(Root);

	Sun = CreateDefaultSubobject<UDirectionalLightComponent>(TEXT("Sun"));
	Sun->SetupAttachment(Root);
	Sun->SetMobility(EComponentMobility::Movable);
	Sun->SetIntensity(10.f);
	Sun->SetAtmosphereSunLight(true);
	Sun->SetAtmosphereSunLightIndex(0);
	Sun->SetLightColor(FLinearColor(1.f, 0.95f, 0.88f));

	Moon = CreateDefaultSubobject<UDirectionalLightComponent>(TEXT("Moon"));
	Moon->SetupAttachment(Root);
	Moon->SetMobility(EComponentMobility::Movable);
	Moon->SetIntensity(0.4f);
	Moon->SetAtmosphereSunLight(true);
	Moon->SetAtmosphereSunLightIndex(1);
	Moon->SetLightColor(FLinearColor(0.55f, 0.65f, 1.f));
	Moon->SetCastShadows(false);

	Atmosphere = CreateDefaultSubobject<USkyAtmosphereComponent>(TEXT("Atmosphere"));
	Atmosphere->SetupAttachment(Root);

	SkyLight = CreateDefaultSubobject<USkyLightComponent>(TEXT("SkyLight"));
	SkyLight->SetupAttachment(Root);
	SkyLight->SetMobility(EComponentMobility::Movable);
	SkyLight->bRealTimeCapture = true;
	SkyLight->SetIntensity(1.f);

	Fog = CreateDefaultSubobject<UExponentialHeightFogComponent>(TEXT("Fog"));
	Fog->SetupAttachment(Root);
	Fog->SetFogDensity(0.004f);
	Fog->SetFogHeightFalloff(0.15f);

	Rng.Initialize(20260925);
}

// ------------------------------------------------------------------ helpers
UInstancedStaticMeshComponent* ASHWorldBuilder::GetISM(UStaticMesh* Mesh, const FLinearColor& C, bool bCollide)
{
	const FString Key = FString::Printf(TEXT("%s_%s_%d"), *GetNameSafe(Mesh), *C.ToFColor(true).ToHex(), bCollide ? 1 : 0);
	if (TObjectPtr<UInstancedStaticMeshComponent>* Found = ISMs.Find(Key)) return Found->Get();
	ASHGameMode* GM = ASHGameMode::Get(this);
	UInstancedStaticMeshComponent* ISM = NewObject<UInstancedStaticMeshComponent>(this);
	ISM->SetStaticMesh(Mesh);
	ISM->SetMaterial(0, GM->ColorMat(C));
	ISM->SetupAttachment(Root);
	if (bCollide)
	{
		ISM->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
		ISM->SetCollisionObjectType(ECC_WorldStatic);
		ISM->SetCollisionResponseToAllChannels(ECR_Block);
	}
	else
	{
		ISM->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		ISM->SetCastShadow(true);
	}
	ISM->SetCanEverAffectNavigation(false);
	ISM->RegisterComponent();
	AddInstanceComponent(ISM);
	ISMs.Add(Key, ISM);
	return ISM;
}

void ASHWorldBuilder::AddInstance(UStaticMesh* Mesh, const FLinearColor& C, bool bCollide, const FTransform& T)
{
	GetISM(Mesh, C, bCollide)->AddInstance(T, true);
}

void ASHWorldBuilder::Box(float X, float Z, float Y0, float W, float D, float H, const FLinearColor& C, float YawDeg, bool bCollide)
{
	const FTransform T(FRotator(0.f, YawDeg, 0.f), SH::W(X, Z, Y0 + H * 0.5f), FVector(W, D, H));
	AddInstance(ASHGameMode::Get(this)->CubeMesh, C, bCollide, T);
}

void ASHWorldBuilder::Cyl(float X, float Z, float Y0, float Diam, float H, const FLinearColor& C, bool bCollide)
{
	const FTransform T(FRotator::ZeroRotator, SH::W(X, Z, Y0 + H * 0.5f), FVector(Diam, Diam, H));
	AddInstance(ASHGameMode::Get(this)->CylinderMesh, C, bCollide, T);
}

void ASHWorldBuilder::Ball(float X, float Z, float YCentre, float Diam, const FLinearColor& C, float SquashY)
{
	const FTransform T(FRotator::ZeroRotator, SH::W(X, Z, YCentre), FVector(Diam, Diam, Diam * SquashY));
	AddInstance(ASHGameMode::Get(this)->SphereMesh, C, false, T);
}

void ASHWorldBuilder::ConeAt(float X, float Z, float Y0, float Diam, float H, const FLinearColor& C)
{
	const FTransform T(FRotator::ZeroRotator, SH::W(X, Z, Y0 + H * 0.5f), FVector(Diam, Diam, H));
	AddInstance(ASHGameMode::Get(this)->ConeMesh, C, false, T);
}

void ASHWorldBuilder::Text(const FString& Str, float X, float Z, float Y, float YawDeg, float SizeM, const FColor& C)
{
	UTextRenderComponent* T = NewObject<UTextRenderComponent>(this);
	T->SetupAttachment(Root);
	T->SetText(FText::FromString(Str));
	T->SetTextRenderColor(C);
	T->SetWorldSize(SizeM * SH::M);
	T->SetHorizontalAlignment(EHTA_Center);
	T->SetVerticalAlignment(EVRTA_TextCenter);
	T->RegisterComponent();
	T->SetWorldLocationAndRotation(SH::W(X, Z, Y), FRotator(0.f, YawDeg, 0.f));
	AddInstanceComponent(T);
}

// ----------------------------------------------------------------- build
void ASHWorldBuilder::Build()
{
	Cities = {
		{ TEXT("DALLAS"), TEXT("BIG D - EVERYTHING IS BIGGER"), -2200.f, -600.f, 175.f, 2.6f, SH::Hex(TEXT("FFB347")) },
		{ TEXT("NEW ORLEANS"), TEXT("LAISSEZ LES BONS TEMPS ROULER"), 0.f, 1300.f, 150.f, 3.4f, SH::Hex(TEXT("B48CFF")) },
		{ TEXT("ATLANTA"), TEXT("THE A - WELCOME TO THE TRAP"), 2200.f, -600.f, 200.f, 2.2f, SH::Hex(TEXT("FF6B6B")) },
	};
	Waters = {
		{ -1500.f, 1500.f, 1770.f, 1990.f, TEXT("Mississippi River") },
		{ -520.f, 520.f, 440.f, 830.f, TEXT("Lake Pontchartrain") },
		{ -2720.f, -2665.f, -1350.f, 250.f, TEXT("Trinity River") },
	};
	BuildGround();
	for (int32 i = 0; i < Cities.Num(); ++i) BuildCity(i);
	BuildHighways();
	BuildWater();
	BuildCountryside();
	BuildTrees();
	SetTimeOfDay(16.5f);
}

void ASHWorldBuilder::BuildGround()
{
	const float W = WORLD_MAX_X - WORLD_MIN_X + 3000.f, D = WORLD_MAX_Z - WORLD_MIN_Z + 3000.f;
	Box((WORLD_MIN_X + WORLD_MAX_X) * 0.5f, (WORLD_MIN_Z + WORLD_MAX_Z) * 0.5f, -1.f, W, D, 1.f, SH::Hex(TEXT("4D6B2F")));
}

int32 ASHWorldBuilder::AddNode(float X, float Z, int32 City)
{
	const FIntPoint Key(FMath::RoundToInt(X), FMath::RoundToInt(Z));
	if (const int32* Found = NodeMap.Find(Key)) return *Found;
	FSHRoadNode N;
	N.P = FVector2D(X, Z);
	N.City = City;
	const int32 Id = Nodes.Add(N);
	NodeMap.Add(Key, Id);
	return Id;
}

void ASHWorldBuilder::AddEdge(int32 A, int32 B, bool bHwy)
{
	FSHRoadEdge E;
	E.A = A; E.B = B; E.bHighway = bHwy;
	E.Len = FVector2D::Distance(Nodes[A].P, Nodes[B].P);
	const int32 Id = Edges.Add(E);
	Nodes[A].Edges.Add(Id);
	Nodes[B].Edges.Add(Id);
}

static FString DistrictFor(int32 Ci, int32 I, int32 J, float& MaxH, bool& bSmall, bool& bPastel, bool& bBrick)
{
	MaxH = 999.f; bSmall = false; bPastel = false; bBrick = false;
	if (Ci == 0)
	{
		if (J <= 1) { MaxH = 120; return TEXT("Uptown"); }
		if (I >= 6 && J <= 5) { MaxH = 22; bSmall = true; bBrick = true; return TEXT("Deep Ellum"); }
		if (I >= 5 && J >= 6) { MaxH = 18; bSmall = true; return TEXT("Fair Park"); }
		if (I <= 3 && J >= 6) { MaxH = 20; bSmall = true; return TEXT("Oak Cliff"); }
		if (I <= 1) { MaxH = 60; bBrick = true; return TEXT("West End"); }
		return TEXT("Downtown Dallas");
	}
	if (Ci == 1)
	{
		if (I >= 5 && J >= 2 && J <= 5) { MaxH = 14; bSmall = true; bPastel = true; return TEXT("French Quarter"); }
		if (I >= 5 && J <= 1) { MaxH = 12; bSmall = true; bPastel = true; return TEXT("Marigny"); }
		if (J <= 1) { MaxH = 14; bSmall = true; return TEXT("Treme"); }
		if (I <= 2 && J >= 5) { MaxH = 14; bSmall = true; bPastel = true; return TEXT("Garden District"); }
		if (J >= 6) { MaxH = 30; bBrick = true; return TEXT("Warehouse District"); }
		if (I <= 1) { MaxH = 24; bSmall = true; return TEXT("Mid-City"); }
		return TEXT("Central Business District");
	}
	if (J == 0) { MaxH = 140; return TEXT("Buckhead"); }
	if (J <= 2) return TEXT("Midtown");
	if (I >= 6) { MaxH = 24; bSmall = true; bBrick = true; return TEXT("Old Fourth Ward"); }
	if (I <= 1 && J >= 5) { MaxH = 18; bSmall = true; return TEXT("West End"); }
	if (J >= 6) { MaxH = 20; bSmall = true; return TEXT("Summerhill"); }
	return TEXT("Downtown Atlanta");
}

static FString SpecialFor(int32 Ci, int32 I, int32 J)
{
	static const TMap<FString, FString> Dallas = {
		{ TEXT("1,4"), TEXT("reunion") }, { TEXT("3,3"), TEXT("bofa_dallas") }, { TEXT("3,2"), TEXT("fountain") }, { TEXT("2,4"), TEXT("park") },
		{ TEXT("6,6"), TEXT("fairpark") }, { TEXT("7,7"), TEXT("megaramp") }, { TEXT("3,1"), TEXT("park") }, { TEXT("0,2"), TEXT("hospital") },
		{ TEXT("5,2"), TEXT("police") }, { TEXT("1,6"), TEXT("safehouse") }, { TEXT("4,5"), TEXT("bank") }, { TEXT("5,4"), TEXT("parking") },
		{ TEXT("2,6"), TEXT("parking") } };
	static const TMap<FString, FString> Nola = {
		{ TEXT("2,4"), TEXT("superdome") }, { TEXT("5,3"), TEXT("cathedral") }, { TEXT("5,4"), TEXT("park") }, { TEXT("3,3"), TEXT("shell") },
		{ TEXT("1,2"), TEXT("hospital") }, { TEXT("3,5"), TEXT("police") }, { TEXT("6,6"), TEXT("safehouse") }, { TEXT("1,6"), TEXT("parking") },
		{ TEXT("0,3"), TEXT("park") } };
	static const TMap<FString, FString> Atl = {
		{ TEXT("3,1"), TEXT("bofa_atl") }, { TEXT("4,4"), TEXT("westin") }, { TEXT("1,4"), TEXT("mbstadium") }, { TEXT("2,3"), TEXT("skyview") },
		{ TEXT("4,5"), TEXT("capitol") }, { TEXT("6,1"), TEXT("park") }, { TEXT("6,4"), TEXT("hospital") }, { TEXT("2,5"), TEXT("police") },
		{ TEXT("5,6"), TEXT("safehouse") }, { TEXT("3,6"), TEXT("parking") } };
	const TMap<FString, FString>& M = Ci == 0 ? Dallas : Ci == 1 ? Nola : Atl;
	const FString* F = M.Find(FString::Printf(TEXT("%d,%d"), I, J));
	return F ? *F : FString();
}

void ASHWorldBuilder::BuildCity(int32 Ci)
{
	const FSHCityDef& C = Cities[Ci];
	const float Size = 8 * PITCH + ROAD_HALF * 2;
	// asphalt + centre lines
	Box(C.CX, C.CZ, -0.05f, Size, Size, 0.08f, SH::Hex(TEXT("34363A")));
	const FLinearColor Yellow = SH::Hex(TEXT("E8C33A"));
	for (int32 L = 0; L <= 8; ++L)
	{
		const float Off = (L - 4) * PITCH;
		Box(C.CX + Off, C.CZ, 0.03f, 0.3f, Size, 0.01f, Yellow, 0.f, false);
		Box(C.CX, C.CZ + Off, 0.03f, Size, 0.3f, 0.01f, Yellow, 0.f, false);
	}
	// road graph
	for (int32 I = 0; I <= 8; ++I)
		for (int32 J = 0; J <= 8; ++J)
			AddNode(C.CX + (I - 4) * PITCH, C.CZ + (J - 4) * PITCH, Ci);
	auto Nid = [&](int32 I, int32 J) { return NodeMap[FIntPoint(FMath::RoundToInt(C.CX + (I - 4) * PITCH), FMath::RoundToInt(C.CZ + (J - 4) * PITCH))]; };
	for (int32 I = 0; I <= 8; ++I)
		for (int32 J = 0; J <= 8; ++J)
		{
			if (I < 8) AddEdge(Nid(I, J), Nid(I + 1, J), false);
			if (J < 8) AddEdge(Nid(I, J), Nid(I, J + 1), false);
		}
	// curbside parking + street lamps
	const FLinearColor Pole = SH::Hex(TEXT("3A3C40"));
	for (int32 L = 0; L <= 8; ++L)
		for (int32 S = 0; S < 8; ++S)
			for (int32 Vert = 0; Vert < 2; ++Vert)
			{
				const float Fixed = (L - 4) * PITCH, S0 = (S - 4) * PITCH;
				for (float A = 25.f; A <= 75.f; A += 50.f)
					for (int32 Side = -1; Side <= 1; Side += 2)
					{
						const float X = C.CX + (Vert ? Fixed + Side * 10.8f : S0 + A);
						const float Z = C.CZ + (Vert ? S0 + A : Fixed + Side * 10.8f);
						Cyl(X, Z, 0.f, 0.25f, 7.5f, Pole, false);
						Box(X, Z, 7.3f, 0.6f, 0.6f, 0.2f, SH::Hex(TEXT("FFE2A8")), 0.f, false);
					}
				if (Rng.FRand() < 0.55f)
				{
					const int32 Side = Rng.FRand() < 0.5f ? -1 : 1;
					const float Along = S0 + 20.f + Rng.FRand() * 60.f;
					FSHSpot Spot;
					Spot.P = Vert ? FVector2D(C.CX + Fixed + Side * 7.6f, C.CZ + Along) : FVector2D(C.CX + Along, C.CZ + Fixed + Side * 7.6f);
					// face the direction of travel for that side of the road
					Spot.Yaw = Vert ? (Side > 0 ? -90.f : 90.f) : (Side > 0 ? 0.f : 180.f);
					Spot.City = Ci;
					ParkingSpots.Add(Spot);
				}
			}
	for (int32 I = 0; I < 8; ++I)
		for (int32 J = 0; J < 8; ++J)
			BuildBlock(Ci, I, J);
	Labels.Add({ C.Name, FVector2D(C.CX, C.CZ - 470.f), C.Color, 1 });
}

void ASHWorldBuilder::BuildBlock(int32 Ci, int32 I, int32 J)
{
	const FSHCityDef& C = Cities[Ci];
	const float BX = C.CX + (I - 3.5f) * PITCH, BZ = C.CZ + (J - 3.5f) * PITCH;
	Box(BX, BZ, 0.f, BLOCK_HALF * 2, BLOCK_HALF * 2, 0.2f, SH::Hex(TEXT("A8A6A2")));
	float MaxH; bool bSmall, bPastel, bBrick;
	const FString District = DistrictFor(Ci, I, J, MaxH, bSmall, bPastel, bBrick);
	FSHBlock B;
	B.C = FVector2D(BX, BZ); B.City = Ci; B.District = District;
	const FString Special = SpecialFor(Ci, I, J);
	if (!Special.IsEmpty())
	{
		B.bOpen = BuildSpecial(Ci, Special, BX, BZ);
	}
	else if (Rng.FRand() < 0.06f)
	{
		BuildPark(BX, BZ, 12, Ci == 1);
		B.bOpen = true;
	}
	else
	{
		BuildBuildings(Ci, BX, BZ, MaxH, District, bSmall, bPastel, bBrick);
	}
	Blocks.Add(B);
}

void ASHWorldBuilder::Building(float X, float Z, float W, float D, float H, const FLinearColor& Wall, int32 Style, float Y0)
{
	// Style: 0 office, 1 glass tower, 2 brick, 3 pastel, 4 residential
	Box(X, Z, Y0, W, D, H, Wall);
	const float Top = Y0 + H;
	if (Style == 1)
	{
		Box(X, Z, Y0 + 0.4f, W + 0.1f, D + 0.1f, H - 0.8f, SH::Hex(TEXT("2D4A66")), 0.f, false);
		for (float Y = Y0 + 3.6f; Y < Top - 1.f; Y += 3.6f)
			Box(X, Z, Y, W + 0.16f, D + 0.16f, 0.35f, Wall, 0.f, false);
	}
	else
	{
		const FLinearColor Glass = Style == 2 ? SH::Hex(TEXT("1F2A33")) : Style == 3 ? SH::Hex(TEXT("233638")) : SH::Hex(TEXT("24313C"));
		const float Band = Style == 3 ? 2.0f : 1.5f;
		for (float Y = Y0 + 2.f; Y < Top - 1.5f; Y += 3.6f)
			Box(X, Z, Y, W + 0.1f, D + 0.1f, Band, Glass, 0.f, false);
		// vertical piers break the bands into windows
		const FLinearColor Pier = Wall;
		const float Step = Style == 3 ? 3.f : 3.6f;
		for (float Off = -W * 0.5f + Step; Off < W * 0.5f - 0.5f; Off += Step)
		{
			Box(X + Off, Z, Y0 + 1.5f, 0.6f, D + 0.2f, H - 2.5f, Pier, 0.f, false);
		}
		for (float Off = -D * 0.5f + Step; Off < D * 0.5f - 0.5f; Off += Step)
		{
			Box(X, Z + Off, Y0 + 1.5f, W + 0.2f, 0.6f, H - 2.5f, Pier, 0.f, false);
		}
	}
	if (H > 20.f)
	{
		const float Mw = W * Rng.FRandRange(0.2f, 0.45f), Md = D * Rng.FRandRange(0.2f, 0.45f);
		Box(X, Z, Top, Mw, Md, Rng.FRandRange(2.f, 5.f), SH::Hex(TEXT("6B6D70")), 0.f, false);
	}
	if (H > 100.f && Rng.FRand() < 0.5f)
	{
		const float Ah = Rng.FRandRange(12.f, 35.f);
		Box(X, Z, Top, 0.8f, 0.8f, Ah, SH::Hex(TEXT("AAAAAA")), 0.f, false);
		Box(X, Z, Top + Ah, 1.4f, 1.4f, 1.4f, SH::Hex(TEXT("FF2020")), 0.f, false);
	}
	if (Style == 3) Balconies(X, Z, W, D, H);
}

void ASHWorldBuilder::Balconies(float X, float Z, float W, float D, float H)
{
	const FLinearColor Iron = SH::Hex(TEXT("1E2A22"));
	for (float Y = 3.6f; Y < H - 1.f; Y += 3.8f)
	{
		const float O = 1.3f;
		Box(X, Z - D * 0.5f - O * 0.5f, Y, W + O * 2, O, 0.18f, Iron, 0.f, false);
		Box(X, Z + D * 0.5f + O * 0.5f, Y, W + O * 2, O, 0.18f, Iron, 0.f, false);
		Box(X, Z - D * 0.5f - O, Y + 0.18f, W + O * 2, 0.06f, 1.f, Iron, 0.f, false);
		Box(X, Z + D * 0.5f + O, Y + 0.18f, W + O * 2, 0.06f, 1.f, Iron, 0.f, false);
	}
}

void ASHWorldBuilder::BuildBuildings(int32 Ci, float BX, float BZ, float MaxH, const FString& District, bool bSmall, bool bPastel, bool bBrick)
{
	const FSHCityDef& C = Cities[Ci];
	const float Dn = FVector2D::Distance(FVector2D(BX, BZ), FVector2D(C.CX, C.CZ)) / 400.f;
	float Tall = C.MaxH * FMath::Exp(-Dn * Dn * C.Falloff) * Rng.FRandRange(0.5f, 1.2f);
	Tall = FMath::Min(Tall, MaxH);
	auto StyleFor = [&](float H, FLinearColor& Col) -> int32
	{
		if (bPastel) { Col = PickC(Rng, PASTELS, 7); return 3; }
		if (bBrick) { Col = PickC(Rng, BRICK, 5); return 2; }
		if (H > 80.f && Rng.FRand() < 0.6f) { Col = PickC(Rng, GLASS, 5); return 1; }
		if (H > 30.f) { Col = PickC(Rng, OFFICE, 5); return 0; }
		if (Rng.FRand() < 0.5f) { Col = PickC(Rng, BRICK, 5); return 2; }
		Col = PickC(Rng, RES, 5); return 4;
	};
	if (bSmall || Tall < 22.f)
	{
		const float W = (LOT * 2) / 3.f;
		for (int32 K = 0; K < 3; ++K)
			for (int32 S = -1; S <= 1; S += 2)
			{
				const float Hh = FMath::Max(6.f, FMath::Min(MaxH, 6.f + Rng.FRand() * FMath::Max(8.f, Tall)));
				const float D = Rng.FRandRange(20.f, 26.f);
				FLinearColor Col; const int32 St = StyleFor(Hh, Col);
				const float Shrink = St == 3 ? 2.6f : 1.2f;
				Building(BX - LOT + W * (K + 0.5f), BZ + S * (LOT - D * 0.5f), W - Shrink, D - (St == 3 ? 2.6f : 0.f), Hh, Col, St);
			}
		return;
	}
	if (Tall > 75.f)
	{
		const float PodH = Rng.FRandRange(8.f, 18.f);
		FLinearColor PodC = PickC(Rng, OFFICE, 5);
		Building(BX, BZ, LOT * 2, LOT * 2, PodH, PodC, 0);
		const float Tw = Rng.FRandRange(28.f, 54.f), Td = Rng.FRandRange(28.f, 54.f);
		const float Tx = BX + (Rng.FRand() - 0.5f) * (LOT * 2 - Tw) * 0.7f, Tz = BZ + (Rng.FRand() - 0.5f) * (LOT * 2 - Td) * 0.7f;
		FLinearColor Col; const int32 St = StyleFor(Tall, Col);
		Building(Tx, Tz, Tw, Td, Tall - PodH, Col, St, PodH);
		if (Rng.FRand() < 0.5f) Building(Tx, Tz, Tw * 0.65f, Td * 0.65f, Rng.FRandRange(8.f, 25.f), Col, St, Tall);
		return;
	}
	for (int32 SX = -1; SX <= 1; SX += 2)
		for (int32 SZ = -1; SZ <= 1; SZ += 2)
		{
			const float Hh = FMath::Max(8.f, Tall * Rng.FRandRange(0.45f, 1.1f));
			FLinearColor Col; const int32 St = StyleFor(Hh, Col);
			Building(BX + SX * LOT * 0.5f, BZ + SZ * LOT * 0.5f, LOT - 1.5f - Rng.FRand() * 6.f, LOT - 1.5f - Rng.FRand() * 6.f, Hh, Col, St);
		}
}

void ASHWorldBuilder::Tree(float X, float Z, float S, int32 Kind)
{
	// 0 oak, 1 pine, 2 palm, 3 cypress
	const FLinearColor Trunk = SH::Hex(TEXT("5A4030"));
	const float TrunkH = (Kind == 2 ? 8.f : 4.5f) * S;
	Cyl(X, Z, 0.f, 0.5f * S, TrunkH, Trunk, true);
	switch (Kind)
	{
	case 1: ConeAt(X, Z, TrunkH - 1.f * S, 5.f * S, 9.f * S, SH::Hex(TEXT("2C4F2A"))); break;
	case 2: Ball(X, Z, TrunkH + 0.5f * S, 5.5f * S, SH::Hex(TEXT("4F8A34")), 0.35f); break;
	case 3: Cyl(X, Z, TrunkH - 1.f * S, 5.f * S, 4.f * S, SH::Hex(TEXT("51683A")), false); break;
	default: Ball(X, Z, TrunkH + 2.f * S, 6.5f * S, SH::Hex(TEXT("3F6B2A"))); break;
	}
}

void ASHWorldBuilder::BuildPark(float BX, float BZ, int32 Trees, bool bPalms)
{
	Box(BX, BZ, 0.2f, LOT * 2 + 2, LOT * 2 + 2, 0.05f, SH::Hex(TEXT("4F7D33")), 0.f, false);
	Box(BX, BZ, 0.25f, LOT * 2 + 2, 3.f, 0.02f, SH::Hex(TEXT("C9B996")), 0.f, false);
	Box(BX, BZ, 0.25f, 3.f, LOT * 2 + 2, 0.02f, SH::Hex(TEXT("C9B996")), 0.f, false);
	for (int32 K = 0; K < Trees; ++K)
	{
		const float X = BX + Rng.FRandRange(-34.f, 34.f), Z = BZ + Rng.FRandRange(-34.f, 34.f);
		if (FMath::Abs(X - BX) < 5.f || FMath::Abs(Z - BZ) < 5.f) continue;
		Tree(X, Z, Rng.FRandRange(0.8f, 1.3f), bPalms ? 2 : (Rng.FRand() < 0.3f ? 1 : 0));
	}
}

void ASHWorldBuilder::BuildParking(int32 Ci, float BX, float BZ)
{
	Box(BX, BZ, 0.2f, LOT * 2, LOT * 2, 0.04f, SH::Hex(TEXT("2F3134")), 0.f, false);
	for (int32 R = 0; R < 3; ++R)
		for (int32 K = 0; K < 5; ++K)
		{
			FSHSpot S;
			S.P = FVector2D(BX - 30.f + K * 15.f, BZ - 20.f + R * 20.f);
			S.Yaw = (R % 2) ? -90.f : 90.f;
			S.City = Ci;
			ParkingSpots.Add(S);
		}
}

void ASHWorldBuilder::Ferris(float X, float Z, float Radius, float YawDeg, const FLinearColor& Col)
{
	ASHGameMode* GM = ASHGameMode::Get(this);
	USceneComponent* Pivot = NewObject<USceneComponent>(this);
	Pivot->SetupAttachment(Root);
	Pivot->RegisterComponent();
	Pivot->SetWorldLocationAndRotation(SH::W(X, Z, Radius + 4.f), FRotator(0.f, YawDeg, 0.f));
	AddInstanceComponent(Pivot);
	USceneComponent* Wheel = NewObject<USceneComponent>(this);
	Wheel->SetupAttachment(Pivot);
	Wheel->RegisterComponent();
	AddInstanceComponent(Wheel);
	for (int32 K = 0; K < 16; ++K)
	{
		const float A = K / 16.f * 360.f;
		const float Rad = FMath::DegreesToRadians(A);
		// rim segment (wheel lies in the local YZ plane, turning about local X)
		const float SegLen = 2.f * PI * Radius / 16.f;
		GM->AddPart(this, Wheel, GM->CubeMesh, FVector(0.f, FMath::Cos(Rad) * Radius * SH::M, FMath::Sin(Rad) * Radius * SH::M), FVector(0.4f, SegLen, 0.4f), Col, FRotator(0.f, 0.f, A + 90.f));
		if (K % 2 == 0)
			GM->AddPart(this, Wheel, GM->CubeMesh, FVector::ZeroVector, FVector(0.25f, 0.25f, Radius * 2.f), Col, FRotator(0.f, 0.f, A));
		GM->AddPart(this, Wheel, GM->CubeMesh, FVector(0.f, FMath::Cos(Rad) * Radius * SH::M, FMath::Sin(Rad) * Radius * SH::M - 120.f), FVector(2.6f, 1.8f, 2.f), SH::Hex(TEXT("FFCC33")));
	}
	for (int32 S = -1; S <= 1; S += 2)
		GM->AddPart(this, Pivot, GM->CubeMesh, FVector(S * 250.f, 0.f, -(Radius + 4.f) * 50.f), FVector(0.8f, 0.8f, Radius + 4.f), SH::Hex(TEXT("999999")));
	Spinners.Add(Wheel);
	Labels.Add({ TEXT("Ferris Wheel"), FVector2D(X, Z), FLinearColor::White, 0 });
}

bool ASHWorldBuilder::BuildSpecial(int32 Ci, const FString& Type, float BX, float BZ)
{
	const FLinearColor White = SH::Hex(TEXT("F4F1EA"));
	const FLinearColor Gold = SH::Hex(TEXT("D4A73A"));
	if (Type == TEXT("park")) { BuildPark(BX, BZ, 14, Ci == 1); return true; }
	if (Type == TEXT("parking")) { BuildParking(Ci, BX, BZ); return true; }
	if (Type == TEXT("hospital"))
	{
		Building(BX, BZ - 8.f, 60.f, 48.f, 34.f, White, 0);
		Box(BX, BZ + 16.3f, 24.f, 2.f, 0.4f, 8.f, SH::Hex(TEXT("E22222")), 0.f, false);
		Box(BX, BZ + 16.3f, 27.f, 8.f, 0.4f, 2.f, SH::Hex(TEXT("E22222")), 0.f, false);
		Text(TEXT("MERCY GENERAL"), BX, BZ + 16.5f, 8.f, 90.f, 3.f, FColor(226, 34, 34));
		Hospitals.Add(FVector2D(BX, BZ + 30.f));
		Labels.Add({ TEXT("+"), FVector2D(BX, BZ), SH::Hex(TEXT("FF4B4B")), 2 });
		return false;
	}
	if (Type == TEXT("police"))
	{
		Building(BX, BZ - 10.f, 64.f, 44.f, 20.f, SH::Hex(TEXT("C8D0E0")), 2);
		Text(TEXT("POLICE"), BX, BZ + 12.4f, 12.f, 90.f, 5.f, FColor(40, 80, 200));
		PoliceStations.Add(FVector2D(BX, BZ + 30.f));
		for (int32 K = 0; K < 4; ++K)
		{
			FSHSpot S; S.P = FVector2D(BX - 24.f + K * 16.f, BZ + 22.f); S.Yaw = 90.f; S.City = Ci; S.bPolice = true;
			ParkingSpots.Add(S);
		}
		Labels.Add({ TEXT("*"), FVector2D(BX, BZ), SH::Hex(TEXT("6AA2FF")), 2 });
		return false;
	}
	if (Type == TEXT("safehouse"))
	{
		Building(BX - 12.f, BZ - 16.f, 36.f, 30.f, 9.f, SH::Hex(TEXT("9A8A80")), 2);
		Box(BX - 12.f, BZ - 0.9f, 0.2f, 10.f, 0.3f, 6.f, SH::Hex(TEXT("777C80")), 0.f, false);
		Text(TEXT("SAFEHOUSE"), BX - 12.f, BZ - 0.6f, 7.6f, 90.f, 2.f, FColor(127, 255, 127));
		Box(BX + 18.f, BZ + 14.f, 0.2f, 22.f, 22.f, 0.06f, SH::Hex(TEXT("3A3B3E")), 0.f, false);
		Box(BX + 18.f, BZ + 14.f, 0.27f, 12.f, 1.2f, 0.02f, SH::Hex(TEXT("F2C230")), 0.f, false);
		Safehouses.Add(FVector2D(BX - 12.f, BZ + 8.f));
		SafehouseCity.Add(Ci);
		FSHSpecial Car; Car.Kind = Ci == 0 ? ESHVehicleKind::Pickup : Ci == 1 ? ESHVehicleKind::Muscle : ESHVehicleKind::Sports;
		Car.P = FVector2D(BX - 22.f, BZ + 20.f); Car.Yaw = 90.f;
		Specials.Add(Car);
		FSHSpecial Heli; Heli.Kind = ESHVehicleKind::Heli; Heli.P = FVector2D(BX + 18.f, BZ + 14.f);
		Specials.Add(Heli);
		Labels.Add({ TEXT("H"), FVector2D(BX, BZ), SH::Hex(TEXT("7FFF7F")), 2 });
		return true;
	}
	if (Type == TEXT("bank"))
	{
		Building(BX, BZ - 6.f, 64.f, 50.f, 26.f, SH::Hex(TEXT("E8E2D0")), 0);
		for (int32 K = -3; K <= 3; ++K) Cyl(BX + K * 8.f, BZ + 21.f, 0.f, 2.2f, 22.f, SH::Hex(TEXT("F0EBDC")));
		Box(BX, BZ + 21.f, 22.f, 62.f, 4.f, 4.f, SH::Hex(TEXT("E8E2D0")));
		Text(TEXT("FEDERAL RESERVE"), BX, BZ + 23.2f, 24.f, 90.f, 3.2f, FColor(212, 167, 58));
		Bank = FVector2D(BX, BZ + 30.f);
		Labels.Add({ TEXT("$"), FVector2D(BX, BZ), SH::Hex(TEXT("33FF33")), 2 });
		return false;
	}
	// ---- Dallas
	if (Type == TEXT("reunion"))
	{
		BuildPark(BX, BZ, 6, false);
		Cyl(BX, BZ, 0.f, 6.f, 150.f, SH::Hex(TEXT("D8D4CC")));
		Cyl(BX + 3.2f, BZ + 1.8f, 0.f, 4.4f, 150.f, SH::Hex(TEXT("D8D4CC")), false);
		Cyl(BX - 3.2f, BZ + 1.8f, 0.f, 4.4f, 150.f, SH::Hex(TEXT("D8D4CC")), false);
		Ball(BX, BZ, 162.f, 30.f, SH::Hex(TEXT("2A2D33")));
		for (int32 K = 0; K < 60; ++K)
		{
			const float A = K * 137.5f * PI / 180.f, Y = 1.f - 2.f * (K + 0.5f) / 60.f, R = FMath::Sqrt(1.f - Y * Y);
			Ball(BX + FMath::Cos(A) * R * 15.3f, BZ + FMath::Sin(A) * R * 15.3f, 162.f + Y * 15.3f, 0.9f, SH::Hex(TEXT("FFE9A0")));
		}
		Labels.Add({ TEXT("Reunion Tower"), FVector2D(BX, BZ), FLinearColor::White, 0 });
		return true;
	}
	if (Type == TEXT("bofa_dallas"))
	{
		Building(BX, BZ, 44.f, 60.f, 14.f, PickC(Rng, OFFICE, 5), 0);
		Building(BX, BZ, 38.f, 38.f, 205.f, SH::Hex(TEXT("3E5569")), 1);
		const FLinearColor G = SH::Hex(TEXT("3DFF6A"));
		for (int32 SX = -1; SX <= 1; SX += 2)
			for (int32 SZ = -1; SZ <= 1; SZ += 2)
				Box(BX + SX * 19.1f, BZ + SZ * 19.1f, 14.f, 0.9f, 0.9f, 191.f, G, 0.f, false);
		for (float Y = 60.f; Y <= 206.f; Y += 72.5f)
		{
			Box(BX, BZ - 19.2f, Y, 38.6f, 0.9f, 0.9f, G, 0.f, false);
			Box(BX, BZ + 19.2f, Y, 38.6f, 0.9f, 0.9f, G, 0.f, false);
			Box(BX - 19.2f, BZ, Y, 0.9f, 38.6f, 0.9f, G, 0.f, false);
			Box(BX + 19.2f, BZ, Y, 0.9f, 38.6f, 0.9f, G, 0.f, false);
		}
		Labels.Add({ TEXT("Bank of America Plaza"), FVector2D(BX, BZ), FLinearColor::White, 0 });
		return false;
	}
	if (Type == TEXT("fountain"))
	{
		BuildPark(BX, BZ, 4, false);
		for (int32 K = 0; K < 8; ++K)
		{
			const float T = K / 8.f;
			Box(BX, BZ, K * 20.f, 34.f * (1.f - T * 0.7f), 34.f * (1.f - T * 0.7f), 20.f, SH::Hex(TEXT("5F8F86")), 45.f, true);
		}
		Labels.Add({ TEXT("Fountain Place"), FVector2D(BX, BZ), FLinearColor::White, 0 });
		return true;
	}
	if (Type == TEXT("fairpark"))
	{
		BuildPark(BX, BZ, 4, false);
		// Big Tex
		const float X = BX - 18.f, Z = BZ + 10.f;
		const FLinearColor Jeans = SH::Hex(TEXT("2B4C8C")), Shirt = SH::Hex(TEXT("C0392B")), Skin = SH::Hex(TEXT("E0B08A")), Hat = SH::Hex(TEXT("F6F1E4"));
		Box(X - 1.4f, Z + 0.4f, 0.f, 1.8f, 3.f, 2.f, SH::Hex(TEXT("5A3620")));
		Box(X + 1.4f, Z + 0.4f, 0.f, 1.8f, 3.f, 2.f, SH::Hex(TEXT("5A3620")));
		Box(X - 1.4f, Z, 2.f, 2.f, 2.f, 7.5f, Jeans);
		Box(X + 1.4f, Z, 2.f, 2.f, 2.f, 7.5f, Jeans);
		Box(X, Z, 9.3f, 5.4f, 3.f, 7.f, Shirt);
		Box(X - 3.5f, Z, 9.3f, 1.6f, 1.6f, 6.5f, Shirt, 0.f, false);
		Box(X + 3.5f, Z, 9.3f, 1.6f, 1.6f, 6.5f, Shirt, 0.f, false);
		Ball(X, Z, 18.f, 3.4f, Skin, 1.1f);
		Cyl(X, Z, 19.6f, 7.5f, 0.4f, Hat, false);
		Cyl(X, Z, 20.f, 3.6f, 2.2f, Hat, false);
		Text(TEXT("HOWDY FOLKS!"), X, Z + 3.f, 25.f, 90.f, 2.f, FColor::Yellow);
		Labels.Add({ TEXT("Big Tex"), FVector2D(X, Z), FLinearColor::White, 0 });
		Ferris(BX + 14.f, BZ - 14.f, 28.f, 0.f, SH::Hex(TEXT("FF3B3B")));
		FSHSpecial M; M.Kind = ESHVehicleKind::Monster; M.P = FVector2D(BX - 18.f, BZ + 30.f); M.Yaw = 90.f;
		Specials.Add(M);
		return true;
	}
	if (Type == TEXT("megaramp"))
	{
		BuildPark(BX, BZ, 0, false);
		Ramp(BX, BZ + 30.f, -90.f, 60.f, 17.f, 26.f);
		FSHSpecial S; S.Kind = ESHVehicleKind::Sports; S.P = FVector2D(BX - 12.f, BZ + 38.f); S.Yaw = -90.f;
		Specials.Add(S);
		Labels.Add({ TEXT("MEGA RAMP"), FVector2D(BX, BZ), SH::Hex(TEXT("FFD23F")), 0 });
		return true;
	}
	// ---- New Orleans
	if (Type == TEXT("superdome"))
	{
		Cyl(BX, BZ, 0.f, 74.f, 16.f, SH::Hex(TEXT("C9C4B8")));
		Ball(BX, BZ, 16.f, 72.f, SH::Hex(TEXT("E8E2C8")), 0.3f);
		Box(BX, BZ, 16.f, 50.f, 50.f, 8.f, SH::Hex(TEXT("E8E2C8")), 0.f, true);
		Labels.Add({ TEXT("Superdome"), FVector2D(BX, BZ), FLinearColor::White, 0 });
		return false;
	}
	if (Type == TEXT("cathedral"))
	{
		const float Cz = BZ - 8.f;
		Box(BX, Cz, 0.f, 24.f, 44.f, 18.f, White);
		Box(BX, Cz, 18.f, 20.f, 40.f, 4.f, SH::Hex(TEXT("5C5F66")));
		Box(BX, Cz + 22.f, 0.f, 7.f, 7.f, 30.f, White);
		ConeAt(BX, Cz + 22.f, 30.f, 8.f, 16.f, SH::Hex(TEXT("3A3D44")));
		for (int32 S = -1; S <= 1; S += 2)
		{
			Box(BX + S * 10.f, Cz + 21.f, 0.f, 5.f, 5.f, 20.f, White);
			ConeAt(BX + S * 10.f, Cz + 21.f, 20.f, 6.f, 10.f, SH::Hex(TEXT("3A3D44")));
		}
		Text(TEXT("ST. LOUIS CATHEDRAL"), BX, Cz + 25.7f, 6.f, 90.f, 1.6f, FColor(60, 60, 60));
		Labels.Add({ TEXT("St. Louis Cathedral"), FVector2D(BX, BZ), FLinearColor::White, 0 });
		return false;
	}
	if (Type == TEXT("shell"))
	{
		Building(BX, BZ, 40.f, 60.f, 12.f, White, 0);
		Building(BX, BZ, 34.f, 34.f, 168.f, White, 0, 12.f);
		Labels.Add({ TEXT("One Shell Square"), FVector2D(BX, BZ), FLinearColor::White, 0 });
		return false;
	}
	// ---- Atlanta
	if (Type == TEXT("bofa_atl"))
	{
		Building(BX, BZ, 40.f, 40.f, 220.f, SH::Hex(TEXT("B89C84")), 0);
		Box(BX, BZ, 220.f, 30.f, 30.f, 14.f, SH::Hex(TEXT("B89C84")));
		for (int32 K = 0; K < 6; ++K)
			Box(BX, BZ, 234.f + K * 4.5f, 30.f - K * 5.f, 30.f - K * 5.f, 4.5f, Gold, 0.f, false);
		Cyl(BX, BZ, 261.f, 1.4f, 30.f, Gold, false);
		Labels.Add({ TEXT("Bank of America Plaza"), FVector2D(BX, BZ), FLinearColor::White, 0 });
		return false;
	}
	if (Type == TEXT("westin"))
	{
		BuildPark(BX, BZ, 5, false);
		Cyl(BX, BZ, 0.f, 38.f, 200.f, SH::Hex(TEXT("6E8FA8")));
		for (float Y = 3.6f; Y < 199.f; Y += 3.6f) Cyl(BX, BZ, Y, 38.3f, 0.4f, SH::Hex(TEXT("C8D4DC")), false);
		Cyl(BX, BZ, 200.f, 42.f, 8.f, SH::Hex(TEXT("44474D")), false);
		Labels.Add({ TEXT("Westin Peachtree Plaza"), FVector2D(BX, BZ), FLinearColor::White, 0 });
		return true;
	}
	if (Type == TEXT("mbstadium"))
	{
		Cyl(BX, BZ, 0.f, 74.f, 32.f, SH::Hex(TEXT("8A939C")));
		ConeAt(BX, BZ, 32.f, 70.f, 6.f, SH::Hex(TEXT("44474D")));
		Cyl(BX, BZ, 25.f, 75.f, 2.f, SH::Hex(TEXT("FF2244")), false);
		Labels.Add({ TEXT("Mercedes-Benz Stadium"), FVector2D(BX, BZ), FLinearColor::White, 0 });
		return false;
	}
	if (Type == TEXT("skyview"))
	{
		BuildPark(BX, BZ, 10, false);
		Ferris(BX + 20.f, BZ + 22.f, 20.f, 90.f, FLinearColor::White);
		Labels.Add({ TEXT("Centennial Olympic Park"), FVector2D(BX, BZ), FLinearColor::White, 0 });
		return true;
	}
	if (Type == TEXT("capitol"))
	{
		BuildPark(BX, BZ, 8, false);
		Box(BX, BZ, 0.f, 56.f, 30.f, 18.f, White);
		Cyl(BX, BZ, 18.f, 16.f, 10.f, White);
		Ball(BX, BZ, 28.f, 17.f, Gold, 1.3f);
		Cyl(BX, BZ, 38.f, 2.5f, 6.f, Gold, false);
		for (int32 K = -3; K <= 3; ++K) Cyl(BX + K * 3.5f, BZ + 16.f, 0.f, 1.6f, 16.f, White);
		Labels.Add({ TEXT("Georgia State Capitol"), FVector2D(BX, BZ), FLinearColor::White, 0 });
		return true;
	}
	BuildPark(BX, BZ, 8, false);
	return true;
}

void ASHWorldBuilder::Ramp(float X, float Z, float YawDeg, float Len, float Height, float Width)
{
	const float Pitch = FMath::RadiansToDegrees(FMath::Atan2(Height, Len));
	const float Slope = FMath::Sqrt(Len * Len + Height * Height);
	const float Rad = FMath::DegreesToRadians(YawDeg);
	const FVector2D Dir(FMath::Cos(Rad), FMath::Sin(Rad));
	const float T = 1.f;
	const float PR = FMath::DegreesToRadians(Pitch);
	// top surface runs from (X,Z,0) to end at Height; box centre sits T/2 below the surface midpoint
	const FVector2D Mid = FVector2D(X, Z) + Dir * (Len * 0.5f + FMath::Sin(PR) * T * 0.5f);
	const float MidY = Height * 0.5f - FMath::Cos(PR) * T * 0.5f;
	const FTransform Tr(FRotator(Pitch, YawDeg, 0.f), SH::W(Mid.X, Mid.Y, MidY), FVector(Slope, Width, T));
	AddInstance(ASHGameMode::Get(this)->CubeMesh, SH::Hex(TEXT("F2C230")), true, Tr);
	// chevrons
	for (float S = 4.f; S < Len - 2.f; S += 6.f)
	{
		const FVector2D P = FVector2D(X, Z) + Dir * S;
		const FTransform Tc(FRotator(Pitch, YawDeg, 0.f), SH::W(P.X, P.Y, Height * S / Len + 0.02f), FVector(1.f, Width * 0.9f, 0.05f));
		AddInstance(ASHGameMode::Get(this)->CubeMesh, SH::Hex(TEXT("111111")), false, Tc);
	}
	Labels.Add({ TEXT("^"), FVector2D(X, Z), SH::Hex(TEXT("FFD23F")), 2 });
}

void ASHWorldBuilder::BuildHighways()
{
	struct FHwy { const TCHAR* Name; TArray<FVector2D> Pts; bool bBridge; };
	const TArray<FHwy> Hwys = {
		{ TEXT("Interstate 20"), { {-1800, -600}, {-900, -600}, {0, -600}, {900, -600}, {1800, -600} }, false },
		{ TEXT("Interstate 49"), { {-2200, -200}, {-2200, 150}, {-1500, 800}, {-950, 1300}, {-400, 1300} }, false },
		{ TEXT("Interstate 59"), { {2200, -200}, {2200, 150}, {1500, 800}, {950, 1300}, {400, 1300} }, false },
		{ TEXT("Lake Pontchartrain Causeway"), { {0, 900}, {0, 300}, {0, -600} }, true },
	};
	const FLinearColor Asphalt = SH::Hex(TEXT("3A3B3E")), Yellow = SH::Hex(TEXT("E8C33A")), White = SH::Hex(TEXT("E6E6E6")), Rail = SH::Hex(TEXT("8A8F96"));
	for (const FHwy& H : Hwys)
	{
		TArray<int32> Ids;
		for (const FVector2D& P : H.Pts) Ids.Add(AddNode(P.X, P.Y, -1));
		for (int32 K = 0; K < Ids.Num() - 1; ++K)
		{
			AddEdge(Ids[K], Ids[K + 1], true);
			const FVector2D A = Nodes[Ids[K]].P, B = Nodes[Ids[K + 1]].P;
			FSHSeg Seg; Seg.A = A; Seg.B = B; Seg.Name = H.Name; Seg.bBridge = H.bBridge;
			Highways.Add(Seg);
			const FVector2D Mid = (A + B) * 0.5f;
			const float Len = FVector2D::Distance(A, B);
			const float Yaw = FMath::RadiansToDegrees(FMath::Atan2(B.Y - A.Y, B.X - A.X));
			const float Y0 = H.bBridge ? 0.1f : -0.02f;
			Box(Mid.X, Mid.Y, Y0, Len + HWY_HALF, HWY_HALF * 2, 0.08f, Asphalt, Yaw, true);
			Box(Mid.X, Mid.Y, Y0 + 0.08f, Len, 0.5f, 0.01f, Yellow, Yaw, false);
			const FVector2D Dir = (B - A) / Len, Right(-Dir.Y, Dir.X);
			for (int32 S = -1; S <= 1; S += 2)
			{
				const FVector2D Lane = Mid + Right * (S * 7.5f);
				for (float D = -Len * 0.5f + 5.f; D < Len * 0.5f - 5.f; D += 20.f)
				{
					const FVector2D P = Lane + Dir * D;
					Box(P.X, P.Y, Y0 + 0.08f, 6.f, 0.25f, 0.01f, White, Yaw, false);
				}
				if (H.bBridge)
				{
					const FVector2D Edge = Mid + Right * (S * (HWY_HALF + 0.6f));
					Box(Edge.X, Edge.Y, Y0, Len, 0.4f, 1.1f, Rail, Yaw, true);
				}
			}
		}
	}
	Labels.Add({ TEXT("I-20"), FVector2D(-450, -640), SH::Hex(TEXT("99CCFF")), 0 });
	Labels.Add({ TEXT("I-49"), FVector2D(-1860, 450), SH::Hex(TEXT("99CCFF")), 0 });
	Labels.Add({ TEXT("I-59"), FVector2D(1860, 450), SH::Hex(TEXT("99CCFF")), 0 });

	// welcome signs
	auto Welcome = [&](float X, float Z, float Yaw, int32 Ci)
	{
		const FSHCityDef& C = Cities[Ci];
		Box(X, Z, 0.f, 0.5f, 0.5f, 5.f, SH::Hex(TEXT("44474D")));
		Box(X, Z, 5.f, 0.4f, 12.f, 5.f, SH::Hex(TEXT("1B2A4A")), Yaw + 90.f, false);
		const float R = FMath::DegreesToRadians(Yaw);
		const float Ox = FMath::Cos(R) * 0.3f, Oz = FMath::Sin(R) * 0.3f;
		Text(TEXT("WELCOME TO"), X + Ox, Z + Oz, 8.8f, Yaw, 0.9f, FColor::White);
		Text(C.Name, X + Ox, Z + Oz, 7.4f, Yaw, 1.8f, C.Color.ToFColor(true));
		Text(C.Tagline, X + Ox, Z + Oz, 5.9f, Yaw, 0.55f, FColor(230, 230, 230));
	};
	Welcome(-1770, -630, 0.f, 0);
	Welcome(-2170, -170, 90.f, 0);
	Welcome(1770, -570, 180.f, 2);
	Welcome(2230, -170, 90.f, 2);
	Welcome(-430, 1270, 180.f, 1);
	Welcome(430, 1330, 0.f, 1);
	Welcome(30, 870, -90.f, 1);
}

void ASHWorldBuilder::BuildWater()
{
	for (const FSHRect& R : Waters)
	{
		Box((R.MinX + R.MaxX) * 0.5f, (R.MinZ + R.MaxZ) * 0.5f, 0.f, R.MaxX - R.MinX, R.MaxZ - R.MinZ, 0.06f, SH::Hex(TEXT("2D5870")), 0.f, false);
		Labels.Add({ R.Name, FVector2D((R.MinX + R.MaxX) * 0.5f, (R.MinZ + R.MaxZ) * 0.5f), SH::Hex(TEXT("8FD3FF")), 0 });
	}
	// causeway pylons
	for (float Z = 450.f; Z < 830.f; Z += 30.f) Box(0.f, Z, -2.f, 32.f, 1.5f, 2.1f, SH::Hex(TEXT("B5B2AA")), 0.f, false);
}

float ASHWorldBuilder::DistToHighway(float X, float Z) const
{
	float Best = TNumericLimits<float>::Max();
	const FVector2D P(X, Z);
	for (const FSHSeg& S : Highways)
	{
		const FVector2D AB = S.B - S.A;
		const float T = FMath::Clamp(FVector2D::DotProduct(P - S.A, AB) / FMath::Max(1.f, AB.SizeSquared()), 0.f, 1.f);
		Best = FMath::Min(Best, FVector2D::Distance(P, S.A + AB * T));
	}
	return Best;
}

void ASHWorldBuilder::BuildCountryside()
{
	// stunt ramps beside the interstates
	Ramp(-1300.f, -576.f, 0.f, 40.f, 7.f, 10.f);
	Ramp(1200.f, -624.f, 180.f, 40.f, 7.f, 10.f);
	Ramp(24.f, 150.f, -90.f, 32.f, 6.f, 10.f);
	// truck stops
	for (const FVector2D& P : { FVector2D(60.f, -660.f), FVector2D(-1440.f, 840.f) })
	{
		Box(P.X, P.Y, 0.f, 80.f, 60.f, 0.06f, SH::Hex(TEXT("3A3B3E")), 0.f, false);
		Box(P.X, P.Y, 6.f, 40.f, 18.f, 1.2f, SH::Hex(TEXT("E23B2E")), 0.f, false);
		for (int32 K = -1; K <= 1; ++K) Box(P.X + K * 12.f, P.Y, 0.f, 1.f, 0.6f, 2.f, FLinearColor::White);
		Box(P.X, P.Y - 30.f, 0.f, 30.f, 14.f, 7.f, SH::Hex(TEXT("DCC9A0")));
		Text(TEXT("BEAVER'S MEGA STOP"), P.X, P.Y - 22.8f, 8.5f, 90.f, 2.2f, FColor(255, 207, 51));
	}
	// Fort McPeach depot (tank + helicopter)
	const float FX = 2760.f, FZ = -300.f;
	Box(FX, FZ, 0.f, 80.f, 80.f, 0.05f, SH::Hex(TEXT("3A3B3E")), 0.f, false);
	Box(FX, FZ - 40.f, 0.f, 80.f, 0.5f, 4.f, SH::Hex(TEXT("777777")));
	Box(FX - 40.f, FZ, 0.f, 0.5f, 80.f, 4.f, SH::Hex(TEXT("777777")));
	Box(FX + 40.f, FZ, 0.f, 0.5f, 80.f, 4.f, SH::Hex(TEXT("777777")));
	Box(FX + 15.f, FZ - 20.f, 0.f, 30.f, 28.f, 12.f, SH::Hex(TEXT("5B6B4A")));
	FSHSpecial Tank; Tank.Kind = ESHVehicleKind::Tank; Tank.P = FVector2D(FX - 10.f, FZ + 10.f); Tank.Yaw = 90.f; Specials.Add(Tank);
	Labels.Add({ TEXT("Fort McPeach Depot"), FVector2D(FX, FZ - 60.f), SH::Hex(TEXT("B5D68A")), 0 });
	// oil pumpjacks around Dallas
	for (int32 K = 0; K < 7; ++K)
	{
		const float X = -2200.f + Rng.FRandRange(-550.f, 550.f), Z = -600.f + (Rng.FRand() < 0.5f ? -1.f : 1.f) * Rng.FRandRange(480.f, 830.f);
		if (DistToHighway(X, Z) < 40.f || IsWater(X, Z)) continue;
		Box(X, Z, 0.f, 2.f, 10.f, 1.f, SH::Hex(TEXT("2A2A2A")));
		Box(X, Z, 1.f, 0.8f, 0.8f, 6.f, SH::Hex(TEXT("2A2A2A")));
		Box(X, Z, 6.5f, 0.8f, 10.f, 0.8f, SH::Hex(TEXT("E8B82A")), 0.f, false);
	}
	// pickups
	const ESHWeapon Ws[] = { ESHWeapon::SMG, ESHWeapon::Shotgun, ESHWeapon::RPG, ESHWeapon::Pistol };
	int32 N = 0;
	for (const FSHBlock& B : Blocks)
	{
		if (Rng.FRand() > 0.14f) continue;
		FSHPickup P;
		P.Type = N % 3 == 0 ? 1 : N % 3 == 1 ? 2 : 0;
		P.Weapon = Ws[N % 4];
		P.P = B.C + FVector2D(Rng.FRandRange(-30.f, 30.f), 39.5f);
		Pickups.Add(P);
		++N;
	}
	FSHPickup Mini; Mini.Type = 0; Mini.Weapon = ESHWeapon::Minigun; Mini.P = FVector2D(2760.f, -280.f); Pickups.Add(Mini);
	FSHPickup Rpg; Rpg.Type = 0; Rpg.Weapon = ESHWeapon::RPG; Rpg.P = FVector2D(20.f, 920.f); Pickups.Add(Rpg);
}

void ASHWorldBuilder::BuildTrees()
{
	int32 Placed = 0;
	for (int32 Tries = 0; Tries < 6000 && Placed < 2600; ++Tries)
	{
		const float X = Rng.FRandRange(WORLD_MIN_X, WORLD_MAX_X), Z = Rng.FRandRange(WORLD_MIN_Z, WORLD_MAX_Z);
		if (CityAt(X, Z, 30.f) >= 0 || DistToHighway(X, Z) < 26.f) continue;
		bool bWater = false;
		for (const FSHRect& R : Waters) if (X > R.MinX - 8 && X < R.MaxX + 8 && Z > R.MinZ - 8 && Z < R.MaxZ + 8) bWater = true;
		if (bWater) continue;
		if (FMath::Abs(X - 2760.f) < 50.f && FMath::Abs(Z + 300.f) < 50.f) continue;
		const int32 Kind = Z > 700.f ? (Rng.FRand() < 0.55f ? 3 : 0) : X > 1000.f ? (Rng.FRand() < 0.7f ? 1 : 0) : (Rng.FRand() < 0.6f ? 0 : 1);
		Tree(X, Z, Rng.FRandRange(0.8f, 1.6f), Kind);
		++Placed;
	}
}

// ------------------------------------------------------------------ queries
bool ASHWorldBuilder::IsWater(float X, float Z) const
{
	for (const FSHRect& R : Waters)
	{
		if (X > R.MinX && X < R.MaxX && Z > R.MinZ && Z < R.MaxZ)
		{
			// the causeway crosses the lake
			for (const FSHSeg& S : Highways)
			{
				if (!S.bBridge) continue;
				const FVector2D P(X, Z), AB = S.B - S.A;
				const float T = FMath::Clamp(FVector2D::DotProduct(P - S.A, AB) / FMath::Max(1.f, AB.SizeSquared()), 0.f, 1.f);
				if (FVector2D::Distance(P, S.A + AB * T) < HWY_HALF + 1.f) return false;
			}
			return true;
		}
	}
	return false;
}

int32 ASHWorldBuilder::CityAt(float X, float Z, float Pad) const
{
	const float Half = 4 * PITCH + ROAD_HALF;
	for (int32 i = 0; i < Cities.Num(); ++i)
		if (FMath::Abs(X - Cities[i].CX) < Half + Pad && FMath::Abs(Z - Cities[i].CZ) < Half + Pad) return i;
	return -1;
}

FString ASHWorldBuilder::ZoneName(float X, float Z, FString& OutCity, FLinearColor& OutColor) const
{
	OutCity.Reset();
	const int32 Ci = CityAt(X, Z, 5.f);
	if (Ci >= 0)
	{
		const FSHCityDef& C = Cities[Ci];
		const int32 I = FMath::Clamp(FMath::FloorToInt((X - C.CX) / PITCH + 4), 0, 7);
		const int32 J = FMath::Clamp(FMath::FloorToInt((Z - C.CZ) / PITCH + 4), 0, 7);
		float MaxH; bool A, B, D;
		OutCity = C.Name;
		OutColor = C.Color;
		return DistrictFor(Ci, I, J, MaxH, A, B, D);
	}
	for (const FSHRect& R : Waters)
		if (X > R.MinX && X < R.MaxX && Z > R.MinZ && Z < R.MaxZ) { OutColor = SH::Hex(TEXT("8FD3FF")); return R.Name; }
	float Best = 60.f; FString Name;
	for (const FSHSeg& S : Highways)
	{
		const FVector2D P(X, Z), AB = S.B - S.A;
		const float T = FMath::Clamp(FVector2D::DotProduct(P - S.A, AB) / FMath::Max(1.f, AB.SizeSquared()), 0.f, 1.f);
		const float D = FVector2D::Distance(P, S.A + AB * T);
		if (D < Best) { Best = D; Name = S.Name; }
	}
	OutColor = SH::Hex(TEXT("99CCFF"));
	if (!Name.IsEmpty()) return Name;
	if (Z > 750.f) { OutColor = SH::Hex(TEXT("8FD16A")); return TEXT("Louisiana Bayou"); }
	if (X < -900.f) { OutColor = SH::Hex(TEXT("C9A36B")); return TEXT("East Texas Piney Woods"); }
	if (X > 900.f) { OutColor = SH::Hex(TEXT("FF9F6B")); return TEXT("Georgia Backwoods"); }
	OutColor = FLinearColor(0.8f, 0.8f, 0.8f);
	return TEXT("Dixie Flats");
}

int32 ASHWorldBuilder::NearestNode(float X, float Z) const
{
	int32 Best = -1; float BD = TNumericLimits<float>::Max();
	for (int32 i = 0; i < Nodes.Num(); ++i)
	{
		const float D = FVector2D::DistSquared(Nodes[i].P, FVector2D(X, Z));
		if (D < BD) { BD = D; Best = i; }
	}
	return Best;
}

bool ASHWorldBuilder::FindPath(int32 From, int32 To, TArray<int32>& Out) const
{
	Out.Reset();
	if (!Nodes.IsValidIndex(From) || !Nodes.IsValidIndex(To)) return false;
	const int32 N = Nodes.Num();
	TArray<float> G; G.Init(TNumericLimits<float>::Max(), N);
	TArray<float> F; F.Init(TNumericLimits<float>::Max(), N);
	TArray<int32> Prev; Prev.Init(-1, N);
	TArray<bool> Closed; Closed.Init(false, N);
	TArray<int32> Open = { From };
	const FVector2D Goal = Nodes[To].P;
	G[From] = 0.f; F[From] = FVector2D::Distance(Nodes[From].P, Goal);
	while (Open.Num())
	{
		int32 BI = 0;
		for (int32 i = 1; i < Open.Num(); ++i) if (F[Open[i]] < F[Open[BI]]) BI = i;
		const int32 Cur = Open[BI];
		Open.RemoveAtSwap(BI);
		if (Cur == To)
		{
			for (int32 C = To; C != -1; C = Prev[C]) Out.Insert(C, 0);
			return true;
		}
		Closed[Cur] = true;
		for (int32 EId : Nodes[Cur].Edges)
		{
			const FSHRoadEdge& E = Edges[EId];
			const int32 Nb = E.Other(Cur);
			if (Closed[Nb]) continue;
			const float Cost = G[Cur] + E.Len * (E.bHighway ? 0.6f : 1.f);
			if (Cost < G[Nb])
			{
				if (G[Nb] == TNumericLimits<float>::Max()) Open.Add(Nb);
				G[Nb] = Cost;
				F[Nb] = Cost + FVector2D::Distance(Nodes[Nb].P, Goal) * 0.6f;
				Prev[Nb] = Cur;
			}
		}
	}
	return false;
}

float ASHWorldBuilder::GroundZ(const FVector& AtCm, float Above) const
{
	FHitResult Hit;
	FCollisionQueryParams Params(SCENE_QUERY_STAT(SHGround), false);
	const FVector Start(AtCm.X, AtCm.Y, AtCm.Z + Above);
	const FVector End(AtCm.X, AtCm.Y, -5000.f);
	if (GetWorld()->LineTraceSingleByObjectType(Hit, Start, End, FCollisionObjectQueryParams(ECC_WorldStatic), Params))
		return Hit.ImpactPoint.Z;
	return 0.f;
}

bool ASHWorldBuilder::LineOfSight(const FVector& A, const FVector& B, const AActor* IgnoreA, const AActor* IgnoreB) const
{
	FCollisionQueryParams Params(SCENE_QUERY_STAT(SHSight), false);
	if (IgnoreA) Params.AddIgnoredActor(IgnoreA);
	if (IgnoreB) Params.AddIgnoredActor(IgnoreB);
	return !GetWorld()->LineTraceTestByObjectType(A, B, FCollisionObjectQueryParams(ECC_WorldStatic), Params);
}

// ------------------------------------------------------------ time of day
void ASHWorldBuilder::SetTimeOfDay(float Hour)
{
	// 6:00 sunrise in the east, 12:00 overhead, 18:00 sunset in the west
	const float Angle = (Hour - 6.f) / 12.f * 180.f;
	Sun->SetWorldRotation(FRotator(-Angle, -30.f, 0.f));
	const float Elev = FMath::Sin(FMath::DegreesToRadians(Angle));
	Sun->SetIntensity(FMath::Clamp(Elev * 3.f, 0.f, 1.f) * 10.f);
	const float Night = FMath::Clamp((0.1f - Elev) / 0.3f, 0.f, 1.f);
	Moon->SetWorldRotation(FRotator(-50.f, 150.f, 0.f));
	Moon->SetIntensity(0.5f * Night);
	SkyLight->SetIntensity(FMath::Lerp(1.f, 0.35f, Night));
}

void ASHWorldBuilder::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	for (USceneComponent* W : Spinners)
		if (W) W->AddLocalRotation(FRotator(0.f, 0.f, 7.f * DeltaSeconds));
}
